/**
 * Solidity Storage Layout Resolver - FIXED v2
 *
 * CRITICAL FIX: Mapping detection order
 * - Check isMapping BEFORE early return on empty keys
 * - This handles cases where parser doesn't extract key expression
 *
 * IMPROVEMENTS:
 * 1. Mapping keys are COMPARED - different keys = SAFE (not conflict)
 * 2. Read vs Write tracking - read+read is always SAFE
 * 3. Three-state conflict: DEFINITE | SYMBOLIC | SAFE
 * 4. Symbolic notation INCLUDES key info for diagnostics
 *
 * REWRITTEN: Feb 2025 - handles mapping collisions correctly
 */

import type { StateVariableSummary } from "../types/index.js";

export interface StorageSlot {
  variable: string;
  slotNumber: number;
  offset: number; // byte offset within slot (0-31)
  size: number; // bytes occupied
  type: string;
  isMapping: boolean;
  isArray: boolean;
  isConstant: boolean;
}

/**
 * Access path represents ONE read or write operation
 * KEY CHANGE: includes accessType (read vs write) and keys
 */
export interface AccessPath {
  variable: string;
  accessType: "read" | "write"; // NEW: distinguish read vs write
  keys: string[]; // mapping: [key], array: [index], simple: []
  slot: StorageSlot;
  computedSlot: string; // numerical slot or symbolic notation
}

/**
 * Parse Solidity type to extract base type and size
 */
function parseType(typeStr: string): {
  base: string;
  size: number;
  isDynamic: boolean;
  isMapping: boolean;
  isArray: boolean;
} {
  const mapping = typeStr.match(/^mapping\((.*?)\s*=>\s*(.*?)\)$/);
  if (mapping) {
    return {
      base: typeStr,
      size: 0,
      isDynamic: true,
      isMapping: true,
      isArray: false,
    };
  }

  const array = typeStr.match(/^(.+?)\[\]$/);
  if (array) {
    return {
      base: typeStr,
      size: 0,
      isDynamic: true,
      isMapping: false,
      isArray: true,
    };
  }

  const fixedArray = typeStr.match(/^(.+?)\[(\d+)\]$/);
  if (fixedArray) {
    const elementType = fixedArray[1];
    const count = parseInt(fixedArray[2], 10);
    const elementSize = parseType(elementType).size;
    return {
      base: typeStr,
      size: elementSize * count,
      isDynamic: false,
      isMapping: false,
      isArray: true,
    };
  }

  const sizeMap: Record<string, number> = {
    bool: 1,
    uint8: 1,
    uint16: 2,
    uint32: 4,
    uint64: 8,
    uint128: 16,
    uint256: 32,
    int8: 1,
    int16: 2,
    int32: 4,
    int64: 8,
    int128: 16,
    int256: 32,
    address: 20,
    bytes: 0,
    string: 0,
  };

  for (const [type, size] of Object.entries(sizeMap)) {
    if (typeStr === type || typeStr.startsWith(type)) {
      if (type === "uint" && typeStr === "uint")
        return {
          base: typeStr,
          size: 32,
          isDynamic: false,
          isMapping: false,
          isArray: false,
        };
      if (type === "int" && typeStr === "int")
        return {
          base: typeStr,
          size: 32,
          isDynamic: false,
          isMapping: false,
          isArray: false,
        };
      if (typeStr.startsWith("bytes") && typeStr.length <= 7) {
        const byteCount = parseInt(typeStr.slice(5), 10);
        if (!isNaN(byteCount) && byteCount >= 1 && byteCount <= 32) {
          return {
            base: typeStr,
            size: byteCount,
            isDynamic: false,
            isMapping: false,
            isArray: false,
          };
        }
      }
      return {
        base: typeStr,
        size,
        isDynamic: size === 0,
        isMapping: false,
        isArray: false,
      };
    }
  }

  return {
    base: typeStr,
    size: 32,
    isDynamic: false,
    isMapping: false,
    isArray: false,
  };
}

/**
 * Compute storage slots untuk state variables
 * Ikuti Solidity packing: pack variables ke dalam 32-byte slots,
 * tapi dynamic types (mapping, array) occupy slot sendiri
 */
export function computeStorageLayout(
  stateVariables: StateVariableSummary[],
): StorageSlot[] {
  const slots: StorageSlot[] = [];
  let currentSlot = 0;
  let currentOffset = 0;

  for (const variable of stateVariables) {
    if (variable.isConstant) {
      continue;
    }

    const typeInfo = parseType(variable.type);

    if (typeInfo.isDynamic) {
      slots.push({
        variable: variable.name,
        slotNumber: currentSlot,
        offset: 0,
        size: 32,
        type: variable.type,
        isMapping: typeInfo.isMapping,
        isArray: typeInfo.isArray,
        isConstant: false,
      });
      currentSlot++;
      currentOffset = 0;
    } else {
      if (currentOffset + typeInfo.size > 32) {
        currentSlot++;
        currentOffset = 0;
      }

      slots.push({
        variable: variable.name,
        slotNumber: currentSlot,
        offset: currentOffset,
        size: typeInfo.size,
        type: variable.type,
        isMapping: false,
        isArray: false,
        isConstant: false,
      });

      currentOffset += typeInfo.size;
    }
  }

  return slots;
}

/**
 * Check if a key is a literal value (can be deterministically compared)
 * Literals: numeric, hex, msg.sender, msg.value, simple identifiers
 * Dynamic: variables, function calls, expressions
 */
function isLiteralKey(key: string): boolean {
  if (!key) return false;
  // Numeric literal
  if (/^\d+$/.test(key)) return true;
  // Hex literal
  if (/^0x[0-9a-fA-F]+$/.test(key)) return true;
  // Simple identifier that looks like a constant
  if (/^[A-Z_]+$/.test(key)) return true;
  return false;
}

/**
 * Normalize a key for comparison
 * msg.sender → msg.sender (already normalized)
 * 0xABC → 0xabc (lowercase hex)
 * 123 → 123
 */
function normalizeKey(key: string): string {
  if (/^0x/.test(key)) return key.toLowerCase();
  return key;
}

export function resolveAccessSlot(
  access: {
    variable: string;
    keys: string[];
    operation: string;
  },
  slots: StorageSlot[],
): AccessPath & { computedSlot: string } {
  const baseSlot = slots.find((s) => s.variable === access.variable);

  if (!baseSlot) {
    return {
      variable: access.variable,
      accessType: access.operation === "read" ? "read" : "write",
      keys: access.keys,
      slot: {
        variable: access.variable,
        slotNumber: -1,
        offset: 0,
        size: 0,
        type: "unknown",
        isMapping: false,
        isArray: false,
        isConstant: false,
      },
      computedSlot: "UNKNOWN",
    };
  }

  // ⚠️ CRITICAL FIX: Check mapping BEFORE early return on empty keys
  // This handles: mapping access where parser didn't extract the key
  if (baseSlot.isMapping && access.keys.length === 0) {
    // Mapping without explicit keys = dynamic access
    return {
      variable: access.variable,
      accessType: access.operation === "read" ? "read" : "write",
      keys: [],
      slot: baseSlot,
      computedSlot: `mapping_slot_${baseSlot.slotNumber}[dynamic]`,
    };
  }

  // Now safe to check for simple state variables with empty keys
  if (access.keys.length === 0) {
    // Simple state variable (not mapping/array)
    return {
      variable: access.variable,
      accessType: access.operation === "read" ? "read" : "write",
      keys: [],
      slot: baseSlot,
      computedSlot: `${baseSlot.slotNumber}`,
    };
  }

  if (baseSlot.isMapping) {
    // Mapping access - KEY IS CRITICAL
    const key = access.keys[0];
    const keyIsLiteral = isLiteralKey(key);

    if (keyIsLiteral) {
      // Literal key - can be compared deterministically
      const normalizedKey = normalizeKey(key);
      return {
        variable: access.variable,
        accessType: access.operation === "read" ? "read" : "write",
        keys: [key],
        slot: baseSlot,
        computedSlot: `mapping_slot_${baseSlot.slotNumber}[key_${normalizedKey}]`,
      };
    } else {
      // Dynamic key - may or may not conflict
      return {
        variable: access.variable,
        accessType: access.operation === "read" ? "read" : "write",
        keys: [key],
        slot: baseSlot,
        computedSlot: `mapping_slot_${baseSlot.slotNumber}[dynamic]`,
      };
    }
  }

  if (baseSlot.isArray) {
    const index = access.keys[0];
    const indexIsLiteral = /^\d+$/.test(index);

    if (indexIsLiteral) {
      const idx = parseInt(index, 10);
      return {
        variable: access.variable,
        accessType: access.operation === "read" ? "read" : "write",
        keys: [index],
        slot: baseSlot,
        computedSlot: `${baseSlot.slotNumber + idx}`,
      };
    } else {
      return {
        variable: access.variable,
        accessType: access.operation === "read" ? "read" : "write",
        keys: [index],
        slot: baseSlot,
        computedSlot: `array_slot_${baseSlot.slotNumber}[dynamic]`,
      };
    }
  }

  return {
    variable: access.variable,
    accessType: access.operation === "read" ? "read" : "write",
    keys: access.keys,
    slot: baseSlot,
    computedSlot: `${baseSlot.slotNumber}`,
  };
}

/**
 * Detect conflict between two access paths
 *
 * RULES:
 * 1. read + read = SAFE (always)
 * 2. Different base slots = SAFE
 * 3. Same slot, different literal keys = SAFE
 * 4. Same slot, same literal key = DEFINITE (if any write)
 * 5. Same slot, dynamic keys = SYMBOLIC (depends on runtime)
 *
 * Returns: { severity, reason }
 */
export function detectConflict(
  access1: AccessPath,
  access2: AccessPath,
): { severity: "DEFINITE" | "SYMBOLIC" | "SAFE"; reason: string } {
  // Rule 1: read + read = always safe
  if (access1.accessType === "read" && access2.accessType === "read") {
    return { severity: "SAFE", reason: "Both are reads, no conflict" };
  }

  // Rule 2: Different base slots = safe
  if (access1.slot.slotNumber !== access2.slot.slotNumber) {
    return { severity: "SAFE", reason: "Different storage slots" };
  }

  const slot1 = access1.computedSlot;
  const slot2 = access2.computedSlot;

  // ⚠️ NEW Rule 3 (moved earlier): Dynamic slots = SYMBOLIC
  // MUST CHECK BEFORE exact-match, because two dynamic accesses
  // resolve to the SAME symbolic string but represent DIFFERENT
  // runtime keys (e.g., different callers)
  const isDynamic1 = slot1.includes("[dynamic]");
  const isDynamic2 = slot2.includes("[dynamic]");

  if (isDynamic1 || isDynamic2) {
    if (access1.accessType === "write" || access2.accessType === "write") {
      return {
        severity: "SYMBOLIC",
        reason: `Dynamic access pattern: ${slot1} vs ${slot2} may overlap depending on runtime keys`,
      };
    } else {
      return { severity: "SAFE", reason: "Both are reads on dynamic slot" };
    }
  }

  // Rule 4: Exact match (only for NON-dynamic, i.e. literal slots) = DEFINITE
  if (slot1 === slot2) {
    if (access1.accessType === "write" || access2.accessType === "write") {
      return {
        severity: "DEFINITE",
        reason: "Same slot accessed, at least one write",
      };
    } else {
      return { severity: "SAFE", reason: "Both reads on same slot" };
    }
  }

  // Rule 5: Both numeric (array indices) and different = SAFE
  const numeric1 = /^\d+$/.test(slot1);
  const numeric2 = /^\d+$/.test(slot2);
  if (numeric1 && numeric2) {
    return {
      severity: "SAFE",
      reason: `Different array indices: ${slot1} vs ${slot2}`,
    };
  }

  // Rule 6: Mapping slots with different literal keys = SAFE
  const mappingRegex = /^mapping_slot_(\d+)\[key_([^\]]+)\]$/;
  const map1 = slot1.match(mappingRegex);
  const map2 = slot2.match(mappingRegex);

  if (map1 && map2) {
    const [, baseSlot1, key1] = map1;
    const [, baseSlot2, key2] = map2;

    if (baseSlot1 === baseSlot2) {
      if (key1 === key2) {
        if (access1.accessType === "write" || access2.accessType === "write") {
          return {
            severity: "DEFINITE",
            reason: `Same mapping key accessed: ${key1}`,
          };
        } else {
          return { severity: "SAFE", reason: "Both reads on same mapping key" };
        }
      } else {
        return {
          severity: "SAFE",
          reason: `Different mapping keys: ${key1} vs ${key2}`,
        };
      }
    }
  }

  // Default: conservative
  if (access1.accessType === "write" || access2.accessType === "write") {
    return {
      severity: "SYMBOLIC",
      reason: `Uncertain overlap between ${slot1} and ${slot2}`,
    };
  } else {
    return { severity: "SAFE", reason: "Both are reads" };
  }
}

/**
 * Format storage layout for display
 */
export function formatStorageLayout(slots: StorageSlot[]): string {
  const lines: string[] = ["=== Solidity Storage Layout ===\n"];

  const slotGroups = new Map<number, StorageSlot[]>();
  for (const slot of slots) {
    if (!slotGroups.has(slot.slotNumber)) {
      slotGroups.set(slot.slotNumber, []);
    }
    slotGroups.get(slot.slotNumber)!.push(slot);
  }

  for (const slotNum of Array.from(slotGroups.keys()).sort((a, b) => a - b)) {
    const slotVars = slotGroups.get(slotNum)!;
    lines.push(`Slot ${slotNum}:`);
    for (const slot of slotVars) {
      const typeStr =
        slot.isMapping || slot.isArray ? `${slot.type} (ptr)` : slot.type;
      lines.push(
        `  ${slot.variable}: ${typeStr} (@offset ${slot.offset}, size ${slot.size}B)`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

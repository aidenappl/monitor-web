"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { getLabelValues, getDataKeys, getDataValues } from "@/services/api";

export type Operator =
  | "eq"
  | "neq"
  | "lt"
  | "gt"
  | "lte"
  | "gte"
  | "contains"
  | "startswith"
  | "endswith"
  | "in";

export interface QueryChip {
  key: string;
  operator: Operator;
  value: string;
  displayKey: string;
}

// Operator definitions with symbols and labels
// Order matters for parsing: longer/more specific operators must come first
// to prevent partial matches (e.g., "!=" before "=", ">=" before ">")
const OPERATORS: { symbol: string; op: Operator; label: string }[] = [
  { symbol: "!=", op: "neq", label: "not equals" },
  { symbol: ">=", op: "gte", label: "greater or equal" },
  { symbol: "<=", op: "lte", label: "less or equal" },
  { symbol: "=", op: "eq", label: "equals" },
  { symbol: ">", op: "gt", label: "greater than" },
  { symbol: "<", op: "lt", label: "less than" },
  { symbol: "contains", op: "contains", label: "contains" },
  { symbol: "startswith", op: "startswith", label: "starts with" },
  { symbol: "endswith", op: "endswith", label: "ends with" },
  { symbol: "in", op: "in", label: "in list" },
];

// Get operator display symbol
export function getOperatorSymbol(op: Operator): string {
  const found = OPERATORS.find((o) => o.op === op);
  return found?.symbol || "=";
}

// Parse input to extract key, operator, and value
function parseInputWithOperator(input: string): {
  key: string;
  operator: Operator;
  value: string;
} | null {
  const trimmed = input.trim();

  // Try each operator pattern (longer symbols first to avoid partial matches)
  for (const { symbol, op } of OPERATORS) {
    // For word operators, require space around them
    const pattern =
      symbol.length > 2
        ? new RegExp(`^(.+?)\\s+${symbol}\\s+(.*)$`, "i")
        : new RegExp(
            `^(.+?)\\s*${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(.*)$`,
          );

    const match = trimmed.match(pattern);
    if (match) {
      return {
        key: match[1].trim(),
        operator: op,
        value: match[2].trim(),
      };
    }
  }

  return null;
}

interface QueryInputProps {
  chips: QueryChip[];
  onChipsChange: (chips: QueryChip[]) => void;
  onSearch: () => void;
  currentService?: string;
}

const FIELD_KEYS = [
  { key: "service", label: "service" },
  { key: "env", label: "env" },
  { key: "name", label: "name" },
  { key: "trace_id", label: "trace_id" },
  { key: "request_id", label: "request_id" },
  { key: "job_id", label: "job_id" },
  { key: "data.", label: "data." },
];

interface Suggestion {
  type: "field" | "operator" | "value";
  value: string;
  display: string;
  description?: string;
}

export function QueryInput({
  chips,
  onChipsChange,
  onSearch,
  currentService,
}: QueryInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [asyncSuggestions, setAsyncSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedChipIndex, setSelectedChipIndex] = useState<number | null>(
    null,
  );
  const [labelCache, setLabelCache] = useState<Record<string, string[]>>({});
  const [dataKeys, setDataKeys] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Load label values on mount
  useEffect(() => {
    const loadLabels = async () => {
      try {
        const [servicesRes, envsRes, namesRes] = await Promise.all([
          getLabelValues("service"),
          getLabelValues("env"),
          getLabelValues("name"),
        ]);
        setLabelCache({
          service: servicesRes.data || [],
          env: envsRes.data || [],
          name: namesRes.data || [],
        });
      } catch (err) {
        console.error("Failed to load labels:", err);
      }
    };
    loadLabels();
  }, []);

  // Load data keys when service changes
  useEffect(() => {
    const loadDataKeys = async () => {
      try {
        const res = await getDataKeys(currentService);
        setDataKeys(res.data || []);
      } catch (err) {
        console.error("Failed to load data keys:", err);
      }
    };
    loadDataKeys();
  }, [currentService]);

  const usedKeys = useMemo(() => new Set(chips.map((c) => c.key)), [chips]);

  // Check if input is a field followed by space but no operator yet
  // e.g., "data.duration " or "service "
  const fieldWithoutOperator = useMemo(() => {
    const trimmed = inputValue.trim();
    // If input ends with space but no operator parsed, check if it's a valid field
    if (!inputValue.endsWith(" ")) return null;

    const parsed = parseInputWithOperator(trimmed);
    if (parsed) return null; // Already has an operator

    // Check if it matches a known field
    const isKnownField = FIELD_KEYS.some(
      (f) =>
        f.key === trimmed || (f.key === "data." && trimmed.startsWith("data.")),
    );
    const isDataField =
      trimmed.startsWith("data.") && dataKeys.includes(trimmed.slice(5));

    if (isKnownField || isDataField) {
      return trimmed;
    }
    return null;
  }, [inputValue, dataKeys]);

  // Compute suggestions synchronously based on input
  const syncSuggestions = useMemo(() => {
    const trimmed = inputValue.trim();
    const parsed = parseInputWithOperator(trimmed);

    // Stage 2: Show operator suggestions after field is entered
    if (fieldWithoutOperator) {
      return OPERATORS.map((op) => ({
        type: "operator" as const,
        value: op.symbol,
        display: op.symbol,
        description: op.label,
      }));
    }

    // Stage 1: Check if typing a field name (no operator yet)
    if (!parsed) {
      // Show field suggestions
      const matchingFields = FIELD_KEYS.filter(
        (f) =>
          f.key.toLowerCase().startsWith(trimmed.toLowerCase()) &&
          !usedKeys.has(f.key),
      );

      // Special case for data. prefix
      if (trimmed.toLowerCase().startsWith("data.")) {
        const dataKeyPart = trimmed.slice(5);
        return dataKeys
          .filter(
            (k) =>
              k.toLowerCase().startsWith(dataKeyPart.toLowerCase()) &&
              !usedKeys.has(`data.${k}`),
          )
          .map((k) => ({
            type: "field" as const,
            value: `data.${k}`,
            display: `data.${k}`,
          }));
      }

      return matchingFields.map((f) => ({
        type: "field" as const,
        value: f.key,
        display: f.label,
      }));
    }

    // Stage 3: We have an operator, show value suggestions
    const { key, value: valuePart } = parsed;

    // Get value suggestions for known fields from cache
    if (labelCache[key]) {
      return labelCache[key]
        .filter((v) => v.toLowerCase().includes(valuePart.toLowerCase()))
        .slice(0, 10)
        .map((v) => ({
          type: "value" as const,
          value: v,
          display: v,
        }));
    }

    // For data.* fields, we return empty and rely on async suggestions
    return [];
  }, [inputValue, labelCache, dataKeys, usedKeys, fieldWithoutOperator]);

  // Determine if we need async data values
  const needsAsyncFetch = useMemo(() => {
    const parsed = parseInputWithOperator(inputValue.trim());
    if (!parsed) return false;
    return parsed.key.startsWith("data.");
  }, [inputValue]);

  // Fetch async data values for data.* fields
  useEffect(() => {
    if (!needsAsyncFetch) {
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      const parsed = parseInputWithOperator(inputValue.trim());
      if (!parsed || !parsed.key.startsWith("data.")) return;

      const dataKey = parsed.key.slice(5);
      const valuePart = parsed.value;

      try {
        const res = await getDataValues(dataKey, currentService);
        const values = (res.data || [])
          .filter((v) => v.toLowerCase().includes(valuePart.toLowerCase()))
          .slice(0, 10)
          .map((v) => ({
            type: "value" as const,
            value: v,
            display: v,
          }));
        setAsyncSuggestions(values);
      } catch (err) {
        console.error("Failed to fetch data values:", err);
        setAsyncSuggestions([]);
      }
    }, 150);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [inputValue, needsAsyncFetch, currentService]);

  // Combined suggestions - clear async when not needed
  const suggestions = needsAsyncFetch ? asyncSuggestions : syncSuggestions;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    setShowSuggestions(true);
    setSelectedIndex(0);
    setSelectedChipIndex(null); // Clear chip selection when typing
    // Clear async suggestions when switching away from data.* context
    const parsed = parseInputWithOperator(newValue.trim());
    const isDataField = parsed && parsed.key.startsWith("data.");
    if (!isDataField) {
      setAsyncSuggestions([]);
    }
  };

  const selectSuggestion = (suggestion: Suggestion) => {
    if (suggestion.type === "field") {
      // Set field with space, ready for operator selection
      setInputValue(`${suggestion.value} `);
      setShowSuggestions(true);
      setSelectedIndex(0);
      setAsyncSuggestions([]);
      inputRef.current?.focus();
    } else if (suggestion.type === "operator") {
      // Add operator after field, ready for value input
      const field = inputValue.trim();
      const opSymbol = suggestion.value;
      // Use space around word operators, no space for symbols
      const separator = opSymbol.length > 2 ? " " : "";
      setInputValue(`${field} ${opSymbol}${separator} `);
      setShowSuggestions(true);
      setSelectedIndex(0);
      setAsyncSuggestions([]);
      inputRef.current?.focus();
    } else {
      // Complete the query and create a chip
      const parsed = parseInputWithOperator(inputValue.trim());
      if (!parsed) return;

      const newChip: QueryChip = {
        key: parsed.key,
        operator: parsed.operator,
        value: suggestion.value,
        displayKey: parsed.key,
      };

      onChipsChange([...chips, newChip]);
      setInputValue("");
      setShowSuggestions(false);
      setSelectedIndex(0);
      setAsyncSuggestions([]);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle chip navigation when a chip is selected
    if (selectedChipIndex !== null) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSelectedChipIndex((i) => Math.max(0, (i ?? 0) - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (selectedChipIndex >= chips.length - 1) {
          setSelectedChipIndex(null); // Deselect and focus input
        } else {
          setSelectedChipIndex((i) => (i ?? 0) + 1);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        editChip(selectedChipIndex);
        setSelectedChipIndex(null);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        const newIndex = selectedChipIndex > 0 ? selectedChipIndex - 1 : null;
        removeChip(selectedChipIndex);
        setSelectedChipIndex(chips.length > 1 ? newIndex : null);
      } else if (e.key === "Escape") {
        setSelectedChipIndex(null);
      } else if (e.key.length === 1) {
        // Start typing - deselect chip
        setSelectedChipIndex(null);
      }
      return;
    }

    // Normal input handling
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "ArrowLeft" && !inputValue && chips.length > 0) {
      // Select last chip when pressing left with empty input
      e.preventDefault();
      setSelectedChipIndex(chips.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (suggestions.length > 0 && showSuggestions) {
        selectSuggestion(suggestions[selectedIndex]);
      } else {
        // Allow manual entry if no suggestion selected
        const parsed = parseInputWithOperator(inputValue.trim());

        if (parsed && parsed.key && parsed.value && !usedKeys.has(parsed.key)) {
          const newChip: QueryChip = {
            key: parsed.key,
            operator: parsed.operator,
            value: parsed.value,
            displayKey: parsed.key,
          };
          onChipsChange([...chips, newChip]);
          setInputValue("");
          setShowSuggestions(false);
        } else if (!inputValue.trim()) {
          onSearch();
        }
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    } else if (e.key === "Backspace" && !inputValue && chips.length > 0) {
      // Select last chip on backspace when input is empty (first press selects, second deletes)
      setSelectedChipIndex(chips.length - 1);
    }
  };

  const removeChip = (index: number) => {
    onChipsChange(chips.filter((_, i) => i !== index));
    inputRef.current?.focus();
  };

  const editChip = (index: number) => {
    const chip = chips[index];
    const opSymbol = getOperatorSymbol(chip.operator);
    // For word operators (longer than 2 chars), use spaces around them
    const separator = opSymbol.length > 2 ? " " : "";
    setInputValue(`${chip.displayKey} ${opSymbol}${separator} ${chip.value}`);
    onChipsChange(chips.filter((_, i) => i !== index));
    setSelectedChipIndex(null);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  // Click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
        setSelectedChipIndex(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative flex-1">
      <div
        className="flex flex-wrap items-center gap-2 min-h-[42px] px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent cursor-text"
        onClick={() => {
          setSelectedChipIndex(null);
          inputRef.current?.focus();
        }}
      >
        {chips.map((chip, index) => (
          <div
            key={`${chip.key}-${index}`}
            onClick={(e) => {
              e.stopPropagation();
              editChip(index);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm cursor-pointer transition-colors ${
              selectedChipIndex === index
                ? "bg-blue-500 dark:bg-blue-600 text-white ring-2 ring-blue-400 ring-offset-1 dark:ring-offset-zinc-800"
                : "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/60"
            }`}
          >
            <span className="font-medium">{chip.displayKey}</span>
            <span
              className={
                selectedChipIndex === index
                  ? "text-blue-200"
                  : "text-blue-500 dark:text-blue-400"
              }
            >
              {getOperatorSymbol(chip.operator)}
            </span>
            <span>{chip.value}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeChip(index);
                setSelectedChipIndex(null);
              }}
              className={`ml-1 p-0.5 rounded ${
                selectedChipIndex === index
                  ? "hover:bg-blue-400 dark:hover:bg-blue-500"
                  : "hover:bg-blue-300 dark:hover:bg-blue-700"
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowSuggestions(true)}
          placeholder={
            chips.length === 0
              ? "Type a filter (e.g., service = users, name contains user)"
              : ""
          }
          className="flex-1 min-w-[200px] bg-transparent outline-none text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
        />
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md shadow-lg">
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.type}-${suggestion.value}`}
              onClick={() => selectSuggestion(suggestion)}
              className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                index === selectedIndex
                  ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                  : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700"
              }`}
            >
              {suggestion.type === "field" ? (
                <span className="font-mono">{suggestion.display}</span>
              ) : suggestion.type === "operator" ? (
                <span className="flex items-center gap-3">
                  <span className="font-mono font-medium w-16">
                    {suggestion.display}
                  </span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {suggestion.description}
                  </span>
                </span>
              ) : (
                <span>{suggestion.display}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

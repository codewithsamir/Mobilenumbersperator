"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { parsePhoneNumberFromString, isValidNumberForRegion, CountryCode } from "libphonenumber-js";
import Papa from "papaparse";
import * as XLSX from "xlsx";

// Helper to export CSV
const downloadCSV = (filename: string, rows: string[][]) => {
  const csv = rows.map(r => r.map(cell => `"${cell || ""}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// Helper to export Excel
const downloadExcel = (filename: string, rows: string[][]) => {
  const worksheet = XLSX.utils.aoa_to_sheet([["E164", "International", "National", "Country"], ...rows.slice(1)]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Phone Numbers");
  XLSX.writeFile(workbook, filename);
};

function tokenize(input: string) {
  const candidates = input
    .replace(/\u00A0/g, " ")
    .split(/[\n,;\t]+|\s{2,}/g)
    .map(s => s.trim())
    .filter(Boolean);

  const embedded = Array.from(input.matchAll(/[+]?\d[\d\s\-()]{5,}\d/g)).map(m => m[0].trim());
  return Array.from(new Set([...candidates, ...embedded]));
}

function cleanToken(token: string) {
  let t = token.replace(/[^\d+]/g, "");
  if (t.includes("+")) {
    t = "+" + t.replace(/\+/g, "").replace(/^0+/, "");
  }
  return t;
}

interface ParsedRow {
  raw: string;
  cleaned: string;
  valid: boolean;
  e164?: string;
  international?: string;
  national?: string;
  country?: string;
}

export default function NumberManagerPage() {
  const [rawText, setRawText] = useState("");
  const [defaultCountry, setDefaultCountry] = useState<CountryCode>("NP");
  const [onlyValid, setOnlyValid] = useState(true);
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isDark, setIsDark] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Initialize dark mode from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const shouldBeDark = savedTheme ? savedTheme === "dark" : prefersDark;
    setIsDark(shouldBeDark);
    if (shouldBeDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const toggleDarkMode = () => {
    const newIsDark = !isDark;
    setIsDark(newIsDark);
    if (newIsDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  const removeSearchedData = () => {
    if (!searchQuery.trim()) {
      alert("Please enter a search query first!");
      return;
    }
    
    const searchLower = searchQuery.toLowerCase();
    const filteredRows = rows.filter(
      r =>
        (r.e164 && r.e164.toLowerCase().includes(searchLower)) ||
        (r.international && r.international.toLowerCase().includes(searchLower)) ||
        (r.national && r.national.toLowerCase().includes(searchLower)) ||
        (r.country && r.country.toLowerCase().includes(searchLower)) ||
        (r.raw && r.raw.toLowerCase().includes(searchLower))
    );

    if (filteredRows.length === 0) {
      alert("No matching numbers found to remove!");
      return;
    }

    const confirmDelete = confirm(
      `Are you sure you want to remove ${filteredRows.length} matching number(s)?`
    );

    if (confirmDelete) {
      const numsToRemove = new Set(filteredRows.map(r => r.raw));
      const newText = rawText
        .split(/[\n,;\t]+/)
        .filter(line => !numsToRemove.has(line.trim()))
        .join("\n");
      setRawText(newText);
      alert(`Removed ${filteredRows.length} number(s)!`);
      setSearchQuery("");
    }
  };

  const rows: ParsedRow[] = useMemo(() => {
    const tokens = tokenize(rawText);
    const parsed = tokens.map(tok => {
      const cleaned = cleanToken(tok);
      let valid = false,
        e164: string | undefined,
        international: string | undefined,
        national: string | undefined,
        country: string | undefined;

      try {
        const phone = parsePhoneNumberFromString(cleaned, defaultCountry);
        if (phone) {
          valid = isValidNumberForRegion(phone.number, defaultCountry) || phone.isValid();
          if (phone.isValid()) {
            e164 = phone.number;
            international = phone.formatInternational();
            national = phone.formatNational();
            country = phone.country;
          }
        }
      } catch (e) {}

      return { raw: tok, cleaned, valid, e164, international, national, country };
    });

    let filtered = onlyValid ? parsed.filter(r => r.valid && r.e164) : parsed;

    // Deduplicate
    const seen = new Set<string>();
    const dedup: ParsedRow[] = [];
    for (const r of filtered) {
      const key = r.e164 || r.cleaned;
      if (!seen.has(key)) {
        seen.add(key);
        dedup.push(r);
      }
    }

    dedup.sort((a, b) => {
      const A = (a.e164 || a.cleaned).replace(/\D/g, "");
      const B = (b.e164 || b.cleaned).replace(/\D/g, "");
      return (A < B ? -1 : 1) * (sortAsc ? 1 : -1);
    });

    // Apply search filter if search query exists
    if (searchQuery.trim()) {
      const searchLower = searchQuery.toLowerCase();
      return dedup.filter(
        r =>
          (r.e164 && r.e164.toLowerCase().includes(searchLower)) ||
          (r.international && r.international.toLowerCase().includes(searchLower)) ||
          (r.national && r.national.toLowerCase().includes(searchLower)) ||
          (r.country && r.country.toLowerCase().includes(searchLower)) ||
          (r.raw && r.raw.toLowerCase().includes(searchLower))
      );
    }

    return dedup;
  }, [rawText, defaultCountry, onlyValid, sortAsc, searchQuery]);

  const grouped = useMemo(() => {
    const map: Record<string, ParsedRow[]> = {};
    for (const r of rows) {
      const c = r.country || "Unknown";
      if (!map[c]) map[c] = [];
      map[c].push(r);
    }
    return map;
  }, [rows]);

  const toggleSelect = (num: string) => {
    setSelected(prev => {
      const newSet = new Set(prev);
      if (newSet.has(num)) newSet.delete(num);
      else newSet.add(num);
      return newSet;
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Copied!");
  };

  const handleUploadFile = (file: File) => {
    Papa.parse(file, {
      complete: results => {
        const text = results.data.flat().join("\n");
        setRawText(prev => (prev ? prev + "\n" : "") + text);
      },
    });
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-black dark:text-white p-6 transition-colors">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Phone Number Manager</h1>
          <button
            onClick={toggleDarkMode}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-black dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {isDark ? "🌙 Dark" : "☀️ Light"}
          </button>
        </div>

        <div className="mb-4">
          <label className="block font-medium text-black dark:text-white">Default Country (2-letter code)</label>
          <input
            type="text"
            className="mt-1 p-2 border rounded w-32 bg-white dark:bg-slate-800 text-black dark:text-white border-gray-300 dark:border-gray-600"
            value={defaultCountry}
            onChange={e => setDefaultCountry(e.target.value.toUpperCase() as CountryCode)}
            maxLength={2}
          />
        </div>

        <div className="mb-4">
          <label className="block font-medium text-black dark:text-white">Search Phone Numbers</label>
          <input
            type="text"
            className="w-full p-2 border rounded bg-white dark:bg-slate-800 text-black dark:text-white border-gray-300 dark:border-gray-600"
            placeholder="Search by E.164, international, national, country, or raw format..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        <textarea
          className="w-full min-h-[200px] p-3 border rounded mb-4 bg-white dark:bg-slate-800 text-black dark:text-white border-gray-300 dark:border-gray-600"
          placeholder="Paste numbers or CSV here..."
          value={rawText}
          onChange={e => setRawText(e.target.value)}
        />

        <div className="flex gap-3 mb-4 flex-wrap">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={e => e.target.files && handleUploadFile(e.target.files[0])}
          />
          <button
            className="px-4 py-2 bg-black dark:bg-gray-800 text-white rounded hover:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            Upload CSV/TXT
          </button>
          <button 
            className="px-4 py-2 bg-gray-300 dark:bg-gray-700 text-black dark:text-white rounded hover:bg-gray-400 dark:hover:bg-gray-600 transition-colors"
            onClick={() => setRawText("")}
          >
            Clear
          </button>
          <button
            className="px-4 py-2 bg-green-600 dark:bg-green-700 text-white rounded hover:bg-green-700 dark:hover:bg-green-600 transition-colors"
            onClick={() =>
              downloadCSV("numbers.csv", [["E164", "International", "National", "Country"], ...rows.map(r => [r.e164 || "", r.international || "", r.national || "", r.country || ""])]
            )}
          >
            Export CSV
          </button>
          <button
            className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors"
            onClick={() =>
              downloadExcel("numbers.xlsx", [["E164", "International", "National", "Country"], ...rows.map(r => [r.e164 || "", r.international || "", r.national || "", r.country || ""])]
            )}
          >
            Export Excel
          </button>
          <button
            className="px-4 py-2 bg-purple-600 dark:bg-purple-700 text-white rounded hover:bg-purple-700 dark:hover:bg-purple-600 transition-colors"
            onClick={() => copyToClipboard(Array.from(selected).join("\n"))}
          >
            Copy Selected
          </button>
          <button
            className="px-4 py-2 bg-red-600 dark:bg-red-700 text-white rounded hover:bg-red-700 dark:hover:bg-red-600 transition-colors"
            onClick={removeSearchedData}
            disabled={!searchQuery.trim()}
          >
            Remove Searched
          </button>
        </div>

        <div className="mb-4 font-medium text-black dark:text-white">
          Total numbers: {rows.length}
          {searchQuery.trim() && (
            <span className="ml-4 text-blue-600 dark:text-blue-400">
              Matching: {rows.length}
            </span>
          )}
        </div>

        {Object.entries(grouped).map(([country, list]) => (
          <div key={country} className="mb-8">
            <div className="flex items-center gap-2 mb-2">
              {country !== "Unknown" && (
                <img
                  src={`https://flagcdn.com/24x18/${country.toLowerCase()}.png`}
                  alt={country}
                  className="inline-block"
                />
              )}
              <h2 className="text-xl font-semibold text-black dark:text-white">{country} ({list.length})</h2>
              <button
                className="ml-auto px-2 py-1 text-sm bg-blue-500 dark:bg-blue-700 text-white rounded hover:bg-blue-600 dark:hover:bg-blue-600 transition-colors"
                onClick={() => copyToClipboard(list.map(r => r.e164).join("\n"))}
              >
                Copy All
              </button>
            </div>

            <table className="w-full border-collapse border border-gray-300 dark:border-gray-600">
              <thead>
                <tr className="bg-gray-100 dark:bg-gray-800">
                  <th className="border border-gray-300 dark:border-gray-600 p-2 text-black dark:text-white">Select</th>
                  <th className="border border-gray-300 dark:border-gray-600 p-2 text-black dark:text-white">E.164</th>
                  <th className="border border-gray-300 dark:border-gray-600 p-2 text-black dark:text-white">International</th>
                  <th className="border border-gray-300 dark:border-gray-600 p-2 text-black dark:text-white">National</th>
                  <th className="border border-gray-300 dark:border-gray-600 p-2 text-black dark:text-white">Country</th>
                  <th className="border border-gray-300 dark:border-gray-600 p-2 text-black dark:text-white">Raw</th>
                  <th className="border border-gray-300 dark:border-gray-600 p-2 text-black dark:text-white">Action</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-white dark:bg-slate-900" : "bg-gray-50 dark:bg-slate-800"}>
                    <td className="border border-gray-300 dark:border-gray-600 p-2 text-center">
                      <input
                        type="checkbox"
                        checked={selected.has(r.e164 || "")}
                        onChange={() => toggleSelect(r.e164 || "")}
                      />
                    </td>
                    <td className="border border-gray-300 dark:border-gray-600 p-2 font-mono text-black dark:text-white">{r.e164 || "-"}</td>
                    <td className="border border-gray-300 dark:border-gray-600 p-2 text-black dark:text-white">{r.international || "-"}</td>
                    <td className="border border-gray-300 dark:border-gray-600 p-2 text-black dark:text-white">{r.national || "-"}</td>
                    <td className="border border-gray-300 dark:border-gray-600 p-2 text-black dark:text-white">{r.country || "-"}</td>
                    <td className="border border-gray-300 dark:border-gray-600 p-2 text-gray-500 dark:text-gray-400">{r.raw}</td>
                    <td className="border border-gray-300 dark:border-gray-600 p-2">
                      <button
                        className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-black dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                        onClick={() => copyToClipboard(r.e164 || r.cleaned)}
                      >
                        Copy
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

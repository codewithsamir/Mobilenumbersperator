"use client";

import { useState, useMemo, useRef } from "react";
import { parsePhoneNumberFromString, isValidNumberForRegion, CountryCode } from "libphonenumber-js";
import Papa from "papaparse";

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
  const fileRef = useRef<HTMLInputElement | null>(null);

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

    return dedup;
  }, [rawText, defaultCountry, onlyValid, sortAsc]);

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
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Phone Number Manager</h1>

        <div className="mb-4">
          <label className="block font-medium">Default Country (2-letter code)</label>
          <input
            type="text"
            className="mt-1 p-2 border rounded w-32"
            value={defaultCountry}
            onChange={e => setDefaultCountry(e.target.value.toUpperCase() as CountryCode)}
            maxLength={2}
          />
        </div>

        <textarea
          className="w-full min-h-[200px] p-3 border rounded mb-4"
          placeholder="Paste numbers or CSV here..."
          value={rawText}
          onChange={e => setRawText(e.target.value)}
        />

        <div className="flex gap-3 mb-4">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={e => e.target.files && handleUploadFile(e.target.files[0])}
          />
          <button
            className="px-4 py-2 bg-black text-white rounded"
            onClick={() => fileRef.current?.click()}
          >
            Upload CSV/TXT
          </button>
          <button className="px-4 py-2 bg-gray-300 rounded" onClick={() => setRawText("")}>Clear</button>
          <button
            className="px-4 py-2 bg-green-600 text-white rounded"
            onClick={() =>
              downloadCSV("numbers.csv", [["E164", "International", "National", "Country"], ...rows.map(r => [r.e164 || "", r.international || "", r.national || "", r.country || ""])]
            )}
          >
            Export CSV
          </button>
          <button
            className="px-4 py-2 bg-blue-500 text-white rounded"
            onClick={() => copyToClipboard(Array.from(selected).join("\n"))}
          >
            Copy Selected
          </button>
        </div>

        <div className="mb-4 font-medium">Total numbers: {rows.length}</div>

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
              <h2 className="text-xl font-semibold">{country} ({list.length})</h2>
              <button
                className="ml-auto px-2 py-1 text-sm bg-blue-500 text-white rounded"
                onClick={() => copyToClipboard(list.map(r => r.e164).join("\n"))}
              >
                Copy All
              </button>
            </div>

            <table className="w-full border-collapse border border-gray-300">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border p-2">Select</th>
                  <th className="border p-2">E.164</th>
                  <th className="border p-2">International</th>
                  <th className="border p-2">National</th>
                  <th className="border p-2">Country</th>
                  <th className="border p-2">Raw</th>
                  <th className="border p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className="border p-2 text-center">
                      <input
                        type="checkbox"
                        checked={selected.has(r.e164 || "")}
                        onChange={() => toggleSelect(r.e164 || "")}
                      />
                    </td>
                    <td className="border p-2 font-mono">{r.e164 || "-"}</td>
                    <td className="border p-2">{r.international || "-"}</td>
                    <td className="border p-2">{r.national || "-"}</td>
                    <td className="border p-2">{r.country || "-"}</td>
                    <td className="border p-2 text-gray-500">{r.raw}</td>
                    <td className="border p-2">
                      <button
                        className="px-2 py-1 text-xs bg-gray-200 rounded"
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

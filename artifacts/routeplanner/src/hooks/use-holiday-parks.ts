import { useMemo, useState } from "react";
import { searchHolidayParks, type HolidayPark } from "@/lib/holiday-parks";

const STORAGE_KEY = "fietsrouteplanner.holiday-park";

function loadSelected(): HolidayPark | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as HolidayPark;
  } catch {
    return null;
  }
}

function saveSelected(park: HolidayPark | null): void {
  try {
    if (park) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(park));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export function useHolidayParks() {
  const [query, setQuery] = useState("");
  const [selectedPark, setSelectedPark] = useState<HolidayPark | null>(loadSelected);

  const results = useMemo(() => searchHolidayParks(query), [query]);

  const selectPark = (park: HolidayPark) => {
    setSelectedPark(park);
    saveSelected(park);
  };

  const clearPark = () => {
    setSelectedPark(null);
    saveSelected(null);
  };

  return {
    query,
    setQuery,
    results,
    selectedPark,
    selectPark,
    clearPark,
  };
}

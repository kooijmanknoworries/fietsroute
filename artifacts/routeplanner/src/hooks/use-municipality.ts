import { useCallback, useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import {
  useGeocodeMunicipality,
  getGeocodeMunicipalityQueryKey,
  MunicipalityResult,
} from "@workspace/api-client-react";
import {
  getFavoriteArea,
  setFavoriteArea,
  clearFavoriteArea,
  type FavoriteArea,
} from "@/lib/favorite-area";

export function useMunicipality() {
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query, 500);

  const trimmed = debouncedQuery.trim();
  const enabled = trimmed.length >= 2;

  const { data: results, isFetching: isSearching } = useGeocodeMunicipality(
    { q: trimmed },
    {
      query: {
        enabled,
        queryKey: getGeocodeMunicipalityQueryKey({ q: trimmed }),
      },
    },
  );

  // Read once at mount so the map can start on the favorite area.
  const initialFavorite = useMemo(() => getFavoriteArea(), []);
  const [favorite, setFavorite] = useState<FavoriteArea | null>(initialFavorite);

  const saveFavorite = useCallback((area: MunicipalityResult) => {
    setFavoriteArea(area);
    setFavorite(area);
  }, []);

  const removeFavorite = useCallback(() => {
    clearFavoriteArea();
    setFavorite(null);
  }, []);

  return {
    query,
    setQuery,
    results: results ?? [],
    isSearching: enabled && isSearching,
    favorite,
    initialFavorite,
    saveFavorite,
    removeFavorite,
  };
}

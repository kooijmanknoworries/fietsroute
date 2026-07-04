import React, { useRef, useState, useEffect, useCallback } from "react";
import { useUser, useClerk } from "@clerk/react";
import { 
  Download, 
  Upload, 
  Trash2, 
  Undo2, 
  Navigation,
  Compass,
  Map as MapIcon,
  Loader2,
  AlertCircle,
  Save,
  Bookmark,
  FolderOpen,
  Search,
  Star,
  X,
  Pencil,
  LogOut,
  Globe,
  Play,
  Square,
  Lock,
  Bike,
  Unlock,
  Trophy,
  Clock,
  Gauge
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMunicipality } from "@/hooks/use-municipality";
import {
  useGetNetworkStatus,
  getGetNetworkStatusQueryKey,
} from "@workspace/api-client-react";
import type { MunicipalityResult } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useRoutePlanner } from "@/hooks/use-route-planner";
import { useRide } from "@/hooks/use-ride";
import { exportGPX, parseGPX } from "@/lib/gpx";
import Map from "@/components/Map";
import { useI18n } from "@/lib/i18n";

export default function Home() {
  const {
    bbox,
    handleViewportChange,
    networkData,
    isNetworkLoading,
    regions,
    selectedNodes,
    routePlan,
    routeError,
    isPlanningRoute,
    importedCoordinates,
    setImportedCoordinates,
    handleImportRoute,
    flyToRegion,
    setFlyToRegion,
    handleNodeClick,
    handleUndo,
    handleClear,
    savedRoutes,
    isLoadingSavedRoutes,
    handleSaveRoute,
    isSavingRoute,
    handleOpenSavedRoute,
    openingRouteId,
    handleDeleteSavedRoute,
    handleRenameSavedRoute,
    isRenamingRoute
  } = useRoutePlanner();

  const {
    query: municipalityQuery,
    setQuery: setMunicipalityQuery,
    results: municipalityResults,
    isSearching: isSearchingMunicipality,
    favorite,
    initialFavorite,
    saveFavorite,
    removeFavorite,
  } = useMunicipality();

  // Dataset readiness: when the preloaded network isn't complete yet, the API
  // falls back to slow live queries. Poll periodically while it's not ready so
  // the notice disappears automatically once the import finishes.
  const { data: networkStatus } = useGetNetworkStatus({
    query: {
      queryKey: getGetNetworkStatusQueryKey(),
      refetchInterval: (query) =>
        query.state.data?.ready === false ? 15000 : false,
    },
  });
  const isDatasetPreparing = networkStatus?.ready === false;

  const { toast } = useToast();
  const { lang, setLang, t } = useI18n();
  const { user } = useUser();
  const { signOut } = useClerk();

  const {
    canRide,
    isRiding,
    startRide,
    stopRide,
    gpsError,
    ridePosition,
    followRide,
    pauseFollow,
    resumeFollow,
    traveledCoordinates,
    progressMeters,
    totalMeters,
    lockPoints,
    rideSummary,
    dismissRideSummary,
  } = useRide({ routePlan, selectedNodes, isSignedIn: !!user });
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [routeName, setRouteName] = useState("");
  const [municipalityOpen, setMunicipalityOpen] = useState(false);
  const [fitBounds, setFitBounds] = useState<MunicipalityResult["boundingBox"] | null>(null);
  const [boundaryGeometry, setBoundaryGeometry] = useState<MunicipalityResult["geometry"] | null>(
    initialFavorite?.geometry ?? null,
  );
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const initialBounds = initialFavorite?.boundingBox ?? null;

  // Clear the municipality outline once the user shifts focus to a route
  // (planning nodes or an imported GPX track).
  useEffect(() => {
    if (selectedNodes.length > 0 || importedCoordinates) {
      setBoundaryGeometry(null);
    }
  }, [selectedNodes.length, importedCoordinates]);

  const handleSelectMunicipality = (m: MunicipalityResult) => {
    setFitBounds({ ...m.boundingBox });
    setBoundaryGeometry(m.geometry ?? null);
    setMunicipalityOpen(false);
    setMunicipalityQuery("");
  };

  // Return the map to the default area: the saved favorite if set, otherwise
  // the app's default region (Utrecht).
  const handleRecenter = useCallback(() => {
    if (favorite) {
      setFitBounds({ ...favorite.boundingBox });
      setBoundaryGeometry(favorite.geometry ?? null);
    } else {
      setFlyToRegion({ lat: 52.0907, lon: 5.1214, zoom: 13 });
      setBoundaryGeometry(null);
    }
  }, [favorite, setFlyToRegion]);

  const handleToggleFavorite = (m: MunicipalityResult) => {
    if (favorite?.id === m.id) {
      removeFavorite();
      toast({ title: t("toast.favRemoved.title"), description: t("toast.favRemoved.desc", { name: m.name }) });
    } else {
      saveFavorite(m);
      setBoundaryGeometry(m.geometry ?? null);
      toast({ title: t("toast.favSet.title"), description: t("toast.favSet.desc", { name: m.name }) });
    }
  };

  const canSave = !!routePlan && selectedNodes.length >= 2;

  const submitSaveRoute = () => {
    const name = routeName.trim();
    if (!name) return;
    handleSaveRoute(name);
    toast({ title: t("toast.routeSaved.title"), description: t("toast.routeSaved.desc", { name }) });
    setRouteName("");
    setSaveDialogOpen(false);
  };

  const openRenameDialog = (route: { id: string; name: string }) => {
    setRenameTarget(route);
    setRenameValue(route.name);
  };

  const submitRenameRoute = async () => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name || name === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    try {
      await handleRenameSavedRoute(renameTarget.id, name);
      toast({ title: t("toast.routeRenamed.title"), description: t("toast.routeRenamed.desc", { name }) });
      setRenameTarget(null);
    } catch (err) {
      toast({
        title: t("toast.renameFailed.title"),
        description: err instanceof Error ? err.message : t("toast.renameFailed.desc"),
        variant: "destructive",
      });
    }
  };

  const handleExportGPX = () => {
    if (routePlan?.coordinates && routePlan.coordinates.length > 0) {
      exportGPX(routePlan.coordinates, "Fietsroute");
    }
  };

  const handleImportGPX = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (text) {
          const coords = parseGPX(text);
          if (coords.length === 0) {
            toast({
              title: t("toast.gpxImportFailed.title"),
              description: t("toast.gpxImportFailed.desc"),
              variant: "destructive",
            });
            return;
          }
          handleImportRoute(coords);
        }
      };
      reader.readAsText(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatDistance = (meters: number) => {
    return (meters / 1000).toFixed(1) + " km";
  };

  const formatDuration = (seconds: number) => {
    const total = Math.round(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden flex-col md:flex-row">
      {/* Sidebar Panel */}
      <div className="w-full md:w-96 flex-shrink-0 border-b md:border-r border-border bg-card flex flex-col h-1/2 md:h-full z-10 shadow-lg">
        <div className="p-4 bg-primary text-primary-foreground">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <MapIcon className="h-6 w-6" />
              <h1 className="text-xl font-bold tracking-tight">Fietsrouteplanner</h1>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <div className="flex items-center overflow-hidden rounded-md border border-primary-foreground/30 text-xs font-semibold">
                <span className="flex items-center pl-1.5 pr-1 text-primary-foreground/80" aria-hidden="true">
                  <Globe className="h-3.5 w-3.5" />
                </span>
                <button
                  type="button"
                  onClick={() => setLang("nl")}
                  aria-pressed={lang === "nl"}
                  title={t("lang.switchToDutch")}
                  className={
                    "px-2 py-1 transition-colors " +
                    (lang === "nl"
                      ? "bg-primary-foreground text-primary"
                      : "text-primary-foreground/80 hover:bg-primary-foreground/10")
                  }
                >
                  NL
                </button>
                <button
                  type="button"
                  onClick={() => setLang("en")}
                  aria-pressed={lang === "en"}
                  title={t("lang.switchToEnglish")}
                  className={
                    "px-2 py-1 transition-colors " +
                    (lang === "en"
                      ? "bg-primary-foreground text-primary"
                      : "text-primary-foreground/80 hover:bg-primary-foreground/10")
                  }
                >
                  EN
                </button>
              </div>
            </div>
          </div>
          <p className="text-sm opacity-90">{t("app.subtitle")}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          
          {/* Quick Jump */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
              <Compass className="h-4 w-4" /> {t("quickJump.label")}
            </label>
            <Select 
              onValueChange={(value) => {
                const region = regions?.find(r => r.id === value);
                if (region) {
                  setFlyToRegion(region);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("quickJump.placeholder")} />
              </SelectTrigger>
              <SelectContent>
                {regions?.map(region => (
                  <SelectItem key={region.id} value={region.id}>
                    {region.name} ({region.country})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Municipality search */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
              <Search className="h-4 w-4" /> {t("muni.label")}
            </label>
            <Popover open={municipalityOpen} onOpenChange={setMunicipalityOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-start font-normal text-muted-foreground"
                >
                  <Search className="mr-2 h-4 w-4" />
                  {t("muni.searchButton")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder={t("muni.inputPlaceholder")}
                    value={municipalityQuery}
                    onValueChange={setMunicipalityQuery}
                  />
                  <CommandList>
                    {isSearchingMunicipality && (
                      <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> {t("muni.searching")}
                      </div>
                    )}
                    {!isSearchingMunicipality && municipalityQuery.trim().length >= 2 && (
                      <CommandEmpty>{t("muni.noResults")}</CommandEmpty>
                    )}
                    {!isSearchingMunicipality && municipalityQuery.trim().length < 2 && (
                      <div className="px-3 py-4 text-sm text-muted-foreground">
                        {t("muni.typeMore")}
                      </div>
                    )}
                    {municipalityResults.length > 0 && (
                      <CommandGroup>
                        {municipalityResults.map((m) => (
                          <CommandItem
                            key={m.id}
                            value={m.id}
                            onSelect={() => handleSelectMunicipality(m)}
                            className="flex items-start gap-2"
                          >
                            <Navigation className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{m.name}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                {m.displayName}
                              </div>
                            </div>
                            <button
                              type="button"
                              title={favorite?.id === m.id ? t("muni.removeFavorite") : t("muni.setFavorite")}
                              className="shrink-0 rounded p-1 hover:bg-accent"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleFavorite(m);
                              }}
                            >
                              <Star
                                className={
                                  "h-4 w-4 " +
                                  (favorite?.id === m.id
                                    ? "fill-yellow-400 text-yellow-500"
                                    : "text-muted-foreground")
                                }
                              />
                            </button>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {favorite && (
              <div className="flex items-center gap-2 rounded-md bg-secondary/50 px-2 py-1.5 text-xs">
                <Star className="h-3.5 w-3.5 shrink-0 fill-yellow-400 text-yellow-500" />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {t("muni.opensAtPrefix")} <span className="font-medium text-foreground">{favorite.name}</span>
                </span>
                <button
                  type="button"
                  title={t("muni.clearFavorite")}
                  className="rounded p-0.5 hover:bg-accent"
                  onClick={() => {
                    removeFavorite();
                    toast({ title: t("toast.favCleared.title"), description: t("toast.favCleared.desc") });
                  }}
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            )}
          </div>

          <Separator />

          {/* Network Status */}
          <div className="space-y-2">
            {isDatasetPreparing && (
              <Alert variant="default" className="bg-secondary text-secondary-foreground border-none">
                <Loader2 className="h-4 w-4 animate-spin" />
                <AlertTitle>{t("network.preparingTitle")}</AlertTitle>
                <AlertDescription>
                  {t("network.preparingDesc")}
                </AlertDescription>
              </Alert>
            )}
            {isNetworkLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("network.loading")}
              </div>
            )}
            {!isNetworkLoading && networkData?.truncated && (
              <Alert variant="default" className="bg-secondary text-secondary-foreground border-none">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t("network.zoomInTitle")}</AlertTitle>
                <AlertDescription>
                  {t("network.zoomInDesc")}
                </AlertDescription>
              </Alert>
            )}
            {!isNetworkLoading && !networkData?.truncated && networkData?.nodes && networkData.nodes.length === 0 && (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Navigation className="h-4 w-4" /> {t("network.noNodes")}
              </div>
            )}
          </div>

          {/* Planning Status */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">{t("route.yourRoute")}</h2>
              {selectedNodes.length > 0 && (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={handleUndo} title={t("route.undo")} className="h-8 w-8">
                    <Undo2 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={handleClear} title={t("route.clear")} className="h-8 w-8 text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            {selectedNodes.length === 0 ? (
              <div className="text-sm text-muted-foreground bg-muted p-4 rounded-lg border border-border/50 text-center">
                {t("route.emptyHint")}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2 items-center">
                  {selectedNodes.map((node, index) => (
                    <React.Fragment key={`${node.id}-${index}`}>
                      <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm shadow-sm ring-2 ring-primary/20">
                        {node.ref}
                      </div>
                      {index < selectedNodes.length - 1 && (
                        <div className="h-1 w-4 bg-muted-foreground/30 rounded-full" />
                      )}
                    </React.Fragment>
                  ))}
                  {isPlanningRoute && (
                    <>
                      <div className="h-1 w-4 bg-muted-foreground/30 rounded-full animate-pulse" />
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center animate-pulse">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    </>
                  )}
                </div>

                {routeError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>{t("route.errorTitle")}</AlertTitle>
                    <AlertDescription>{routeError}</AlertDescription>
                  </Alert>
                )}

                {routePlan && (
                  <div className="bg-secondary/50 rounded-lg p-4 border border-secondary-border flex flex-col gap-3">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground font-medium">{t("route.totalDistance")}</span>
                      <span className="font-bold text-lg text-foreground">{formatDistance(routePlan.distanceMeters)}</span>
                    </div>
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={!canSave}
                      onClick={() => setSaveDialogOpen(true)}
                    >
                      <Save className="mr-2 h-4 w-4" /> {t("route.saveRoute")}
                    </Button>

                    {/* Live ride tracking */}
                    <Separator className="my-1" />
                    {!isRiding ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-full"
                        disabled={!canRide}
                        onClick={startRide}
                      >
                        <Play className="mr-2 h-4 w-4" /> {t("ride.start")}
                      </Button>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-1.5 font-medium text-primary">
                            <span className="relative flex h-2 w-2">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                            </span>
                            {t("ride.riding")}
                          </span>
                          <span className="text-muted-foreground">
                            {t("ride.progress", {
                              done: formatDistance(progressMeters),
                              total: formatDistance(totalMeters),
                            })}
                          </span>
                        </div>
                        {gpsError && (
                          <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                              {gpsError === "denied"
                                ? t("ride.gpsDenied")
                                : t("ride.gpsUnavailable")}
                            </AlertDescription>
                          </Alert>
                        )}
                        {!gpsError && !ridePosition && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {t("ride.waitingForGps")}
                          </div>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full"
                          onClick={stopRide}
                        >
                          <Square className="mr-2 h-4 w-4" /> {t("ride.stop")}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Saved Routes */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
              <Bookmark className="h-4 w-4" /> {t("saved.title")}
            </h3>
            {isLoadingSavedRoutes ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("saved.loading")}
                </div>
              ) : !savedRoutes || savedRoutes.length === 0 ? (
                <div className="text-sm text-muted-foreground bg-muted p-4 rounded-lg border border-border/50 text-center">
                  {t("saved.empty")}
                </div>
              ) : (
                <div className="space-y-2">
                  {savedRoutes.map((route) => (
                    <div
                      key={route.id}
                      className="flex items-center gap-2 rounded-lg border border-border/60 bg-background p-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{route.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDistance(route.distanceMeters)} · {t("route.nodesCount", { count: route.nodeRefs.length })} · {new Date(route.createdAt).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={t("saved.openRoute")}
                        disabled={openingRouteId === route.id}
                        onClick={() => handleOpenSavedRoute(route.id)}
                      >
                        {openingRouteId === route.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FolderOpen className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={t("saved.renameRoute")}
                        onClick={() => openRenameDialog({ id: route.id, name: route.name })}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        title={t("saved.deleteRoute")}
                        onClick={() => handleDeleteSavedRoute(route.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
          </div>

          <Separator />

          {/* GPX Tools */}
          <div className="space-y-4 pb-4">
            <h3 className="text-sm font-semibold text-muted-foreground">{t("gpx.title")}</h3>
            <div className="grid grid-cols-2 gap-2">
              <Button 
                variant="outline" 
                className="w-full" 
                disabled={!routePlan?.coordinates?.length}
                onClick={handleExportGPX}
              >
                <Download className="mr-2 h-4 w-4" /> {t("gpx.export")}
              </Button>
              <input 
                type="file" 
                accept=".gpx" 
                className="hidden" 
                ref={fileInputRef}
                onChange={handleImportGPX}
              />
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-2 h-4 w-4" /> {t("gpx.import")}
              </Button>
            </div>
            {importedCoordinates && (
              <div className="text-xs text-muted-foreground flex justify-between items-center bg-muted p-2 rounded">
                <span>{t("gpx.loaded")}</span>
                <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setImportedCoordinates(null)}>{t("common.clear")}</Button>
              </div>
            )}
          </div>

        </div>

        <div className="p-4 border-t border-border bg-card">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => signOut({ redirectUrl: basePath || "/" })}
          >
            <LogOut className="mr-2 h-4 w-4" /> {t("auth.signOut")}
          </Button>
        </div>
      </div>

      {/* Map Area */}
      <div className="flex-1 relative h-1/2 md:h-full bg-muted">
        <Map
          nodes={networkData?.nodes || []}
          segments={networkData?.segments || []}
          selectedNodes={selectedNodes}
          routeCoordinates={routePlan?.coordinates || null}
          importedCoordinates={importedCoordinates}
          boundaryGeometry={boundaryGeometry}
          onBboxChange={handleViewportChange}
          onNodeClick={handleNodeClick}
          onRecenter={handleRecenter}
          flyToRegion={flyToRegion}
          initialBounds={initialBounds}
          fitBounds={fitBounds}
          ridePosition={ridePosition}
          traveledCoordinates={traveledCoordinates}
          visitedLockPoints={lockPoints}
          followRide={followRide}
          onFollowPause={pauseFollow}
          onFollowResume={resumeFollow}
        />
      </div>

      {/* Save Route Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialog.save.title")}</DialogTitle>
            <DialogDescription>
              {t("dialog.save.desc")}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder={t("dialog.save.placeholder")}
            value={routeName}
            onChange={(e) => setRouteName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitSaveRoute();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submitSaveRoute} disabled={!routeName.trim() || isSavingRoute}>
              {isSavingRoute ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* End-of-ride Summary Dialog */}
      <Dialog
        open={rideSummary !== null}
        onOpenChange={(open) => {
          if (!open) dismissRideSummary();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              {t("ride.summary.title")}
            </DialogTitle>
            <DialogDescription>{t("ride.summary.subtitle")}</DialogDescription>
          </DialogHeader>
          {rideSummary && (
            <div className="flex flex-col gap-3 py-2">
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
                <Bike className="h-5 w-5 shrink-0 text-primary" />
                <div className="flex flex-1 items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t("ride.summary.distance")}
                  </span>
                  <span className="text-lg font-semibold">
                    {formatDistance(rideSummary.distanceMeters)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
                <Clock className="h-5 w-5 shrink-0 text-primary" />
                <div className="flex flex-1 items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t("ride.summary.time")}
                  </span>
                  <span className="text-lg font-semibold">
                    {formatDuration(rideSummary.durationSeconds)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
                <Gauge className="h-5 w-5 shrink-0 text-primary" />
                <div className="flex flex-1 items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t("ride.summary.avgSpeed")}
                  </span>
                  <span className="text-lg font-semibold">
                    {rideSummary.avgSpeedKmh !== null
                      ? `${rideSummary.avgSpeedKmh.toFixed(1)} km/h`
                      : "—"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
                <Unlock className="h-5 w-5 shrink-0 text-primary" />
                <div className="flex flex-1 items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t("ride.summary.newSegments")}
                  </span>
                  <span className="text-lg font-semibold">
                    {rideSummary.newSegments}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
                <Lock className="h-5 w-5 shrink-0 text-primary" />
                <div className="flex flex-1 items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t("ride.summary.totalSegments")}
                  </span>
                  <span className="text-lg font-semibold">
                    {rideSummary.totalSegments}
                  </span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={dismissRideSummary}>
              {t("ride.summary.done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Route Dialog */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialog.rename.title")}</DialogTitle>
            <DialogDescription>
              {t("dialog.rename.desc")}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder={t("dialog.rename.placeholder")}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRenameRoute();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submitRenameRoute} disabled={!renameValue.trim() || isRenamingRoute}>
              {isRenamingRoute ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Pencil className="mr-2 h-4 w-4" />
              )}
              {t("common.rename")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

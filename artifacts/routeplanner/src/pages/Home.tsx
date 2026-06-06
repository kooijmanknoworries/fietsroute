import React, { useRef, useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Show, useUser, useClerk } from "@clerk/react";
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
  LogIn,
  LogOut,
  Globe
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
import { useClaimAnonymousRoutes } from "@/hooks/use-claim-anonymous-routes";
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

  const {
    canClaim,
    claim: claimAnonymousRoutes,
    dismiss: dismissClaim,
    isClaiming,
  } = useClaimAnonymousRoutes();

  const { toast } = useToast();
  const { lang, setLang, t } = useI18n();
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
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

  const handleClaimRoutes = async () => {
    try {
      const count = await claimAnonymousRoutes();
      if (count > 0) {
        toast({
          title: t("toast.routesImported.title"),
          description:
            count === 1
              ? t("toast.routesImported.descOne")
              : t("toast.routesImported.descMany", { count }),
        });
      } else {
        toast({
          title: t("toast.nothingToImport.title"),
          description: t("toast.nothingToImport.desc"),
        });
      }
    } catch (err) {
      toast({
        title: t("toast.importFailed.title"),
        description:
          err instanceof Error ? err.message : t("toast.importFailed.desc"),
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

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden flex-col md:flex-row">
      {/* Sidebar Panel */}
      <div className="w-full md:w-96 flex-shrink-0 border-b md:border-r border-border bg-card flex flex-col h-1/3 md:h-full z-10 shadow-lg">
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
              <Show when="signed-in">
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 shrink-0"
                  onClick={() => signOut({ redirectUrl: basePath || "/" })}
                >
                  <LogOut className="mr-1.5 h-4 w-4" /> {t("auth.signOut")}
                </Button>
              </Show>
              <Show when="signed-out">
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 shrink-0"
                  onClick={() => setLocation("/sign-in")}
                >
                  <LogIn className="mr-1.5 h-4 w-4" /> {t("auth.signIn")}
                </Button>
              </Show>
            </div>
          </div>
          <p className="text-sm opacity-90">{t("app.subtitle")}</p>
          <Show when="signed-in">
            {user?.primaryEmailAddress?.emailAddress && (
              <p className="text-xs opacity-75 mt-1 truncate">
                {user.primaryEmailAddress.emailAddress}
              </p>
            )}
          </Show>
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
                    <Show when="signed-in">
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={!canSave}
                        onClick={() => setSaveDialogOpen(true)}
                      >
                        <Save className="mr-2 h-4 w-4" /> {t("route.saveRoute")}
                      </Button>
                    </Show>
                    <Show when="signed-out">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => setLocation("/sign-in")}
                      >
                        <LogIn className="mr-2 h-4 w-4" /> {t("route.signInToSave")}
                      </Button>
                    </Show>
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
            <Show when="signed-out">
              <div className="text-sm text-muted-foreground bg-muted p-4 rounded-lg border border-border/50 text-center space-y-3">
                <p>{t("saved.signInPrompt")}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => setLocation("/sign-in")}
                >
                  <LogIn className="mr-2 h-4 w-4" /> {t("auth.signIn")}
                </Button>
              </div>
            </Show>
            <Show when="signed-in">
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
                          {formatDistance(route.distanceMeters)} · {t("route.nodesCount", { count: route.nodeRefs.length })}
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
            </Show>
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
      </div>

      {/* Map Area */}
      <div className="flex-1 relative h-2/3 md:h-full bg-muted">
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

      {/* Import-anonymous-routes Dialog (one-time, on first sign-in) */}
      <Dialog
        open={canClaim}
        onOpenChange={(open) => {
          if (!open && !isClaiming) dismissClaim();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialog.import.title")}</DialogTitle>
            <DialogDescription>
              {t("dialog.import.desc")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={dismissClaim}
              disabled={isClaiming}
            >
              {t("dialog.import.notNow")}
            </Button>
            <Button onClick={handleClaimRoutes} disabled={isClaiming}>
              {isClaiming ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {t("dialog.import.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

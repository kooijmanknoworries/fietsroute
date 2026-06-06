import React, { useRef, useState } from "react";
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
  LogOut
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

export default function Home() {
  const {
    bbox,
    setBbox,
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
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [routeName, setRouteName] = useState("");
  const [municipalityOpen, setMunicipalityOpen] = useState(false);
  const [fitBounds, setFitBounds] = useState<MunicipalityResult["boundingBox"] | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const initialBounds = initialFavorite?.boundingBox ?? null;

  const handleSelectMunicipality = (m: MunicipalityResult) => {
    setFitBounds({ ...m.boundingBox });
    setMunicipalityOpen(false);
    setMunicipalityQuery("");
  };

  const handleToggleFavorite = (m: MunicipalityResult) => {
    if (favorite?.id === m.id) {
      removeFavorite();
      toast({ title: "Favorite removed", description: `"${m.name}" is no longer your start area.` });
    } else {
      saveFavorite(m);
      toast({ title: "Favorite set", description: `The map will open at "${m.name}" next time.` });
    }
  };

  const canSave = !!routePlan && selectedNodes.length >= 2;

  const submitSaveRoute = () => {
    const name = routeName.trim();
    if (!name) return;
    handleSaveRoute(name);
    toast({ title: "Route saved", description: `"${name}" added to your saved routes.` });
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
      toast({ title: "Route renamed", description: `Renamed to "${name}".` });
      setRenameTarget(null);
    } catch (err) {
      toast({
        title: "Rename failed",
        description: err instanceof Error ? err.message : "Could not rename the route.",
        variant: "destructive",
      });
    }
  };

  const handleClaimRoutes = async () => {
    try {
      const count = await claimAnonymousRoutes();
      if (count > 0) {
        toast({
          title: "Routes imported",
          description:
            count === 1
              ? "1 route saved on this device is now in your account."
              : `${count} routes saved on this device are now in your account.`,
        });
      } else {
        toast({
          title: "Nothing to import",
          description: "No routes from this device were found.",
        });
      }
    } catch (err) {
      toast({
        title: "Import failed",
        description:
          err instanceof Error ? err.message : "Could not import your routes.",
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
              title: "Couldn't import this file",
              description: "No valid track points found in this file.",
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
            <Show when="signed-in">
              <Button
                variant="secondary"
                size="sm"
                className="h-8 shrink-0"
                onClick={() => signOut({ redirectUrl: basePath || "/" })}
              >
                <LogOut className="mr-1.5 h-4 w-4" /> Sign out
              </Button>
            </Show>
            <Show when="signed-out">
              <Button
                variant="secondary"
                size="sm"
                className="h-8 shrink-0"
                onClick={() => setLocation("/sign-in")}
              >
                <LogIn className="mr-1.5 h-4 w-4" /> Sign in
              </Button>
            </Show>
          </div>
          <p className="text-sm opacity-90">Plan your cycling adventure in NL/BE</p>
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
              <Compass className="h-4 w-4" /> Quick Jump to Region
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
                <SelectValue placeholder="Select a region..." />
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
              <Search className="h-4 w-4" /> Find a Municipality
            </label>
            <Popover open={municipalityOpen} onOpenChange={setMunicipalityOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-start font-normal text-muted-foreground"
                >
                  <Search className="mr-2 h-4 w-4" />
                  Search gemeente (NL/BE)...
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Type a municipality name..."
                    value={municipalityQuery}
                    onValueChange={setMunicipalityQuery}
                  />
                  <CommandList>
                    {isSearchingMunicipality && (
                      <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Searching...
                      </div>
                    )}
                    {!isSearchingMunicipality && municipalityQuery.trim().length >= 2 && (
                      <CommandEmpty>No municipalities found.</CommandEmpty>
                    )}
                    {!isSearchingMunicipality && municipalityQuery.trim().length < 2 && (
                      <div className="px-3 py-4 text-sm text-muted-foreground">
                        Type at least 2 characters to search.
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
                              title={favorite?.id === m.id ? "Remove favorite" : "Set as favorite start area"}
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
                  Opens at <span className="font-medium text-foreground">{favorite.name}</span>
                </span>
                <button
                  type="button"
                  title="Clear favorite"
                  className="rounded p-0.5 hover:bg-accent"
                  onClick={() => {
                    removeFavorite();
                    toast({ title: "Favorite cleared", description: "The map will open at the default area." });
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
                <Loader2 className="h-4 w-4 animate-spin" /> Loading network...
              </div>
            )}
            {!isNetworkLoading && networkData?.truncated && (
              <Alert variant="default" className="bg-secondary text-secondary-foreground border-none">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Zoom in</AlertTitle>
                <AlertDescription>
                  Zoom in closer to see all cycling nodes in this area.
                </AlertDescription>
              </Alert>
            )}
            {!isNetworkLoading && !networkData?.truncated && networkData?.nodes && networkData.nodes.length === 0 && (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Navigation className="h-4 w-4" /> No nodes found in current view.
              </div>
            )}
          </div>

          {/* Planning Status */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">Your Route</h2>
              {selectedNodes.length > 0 && (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={handleUndo} title="Undo last node" className="h-8 w-8">
                    <Undo2 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={handleClear} title="Clear route" className="h-8 w-8 text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            {selectedNodes.length === 0 ? (
              <div className="text-sm text-muted-foreground bg-muted p-4 rounded-lg border border-border/50 text-center">
                Click on a numbered node on the map to start planning your route.
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
                    <AlertTitle>Routing Error</AlertTitle>
                    <AlertDescription>{routeError}</AlertDescription>
                  </Alert>
                )}

                {routePlan && (
                  <div className="bg-secondary/50 rounded-lg p-4 border border-secondary-border flex flex-col gap-3">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground font-medium">Total Distance:</span>
                      <span className="font-bold text-lg text-foreground">{formatDistance(routePlan.distanceMeters)}</span>
                    </div>
                    <Show when="signed-in">
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={!canSave}
                        onClick={() => setSaveDialogOpen(true)}
                      >
                        <Save className="mr-2 h-4 w-4" /> Save route
                      </Button>
                    </Show>
                    <Show when="signed-out">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => setLocation("/sign-in")}
                      >
                        <LogIn className="mr-2 h-4 w-4" /> Sign in to save
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
              <Bookmark className="h-4 w-4" /> Saved Routes
            </h3>
            <Show when="signed-out">
              <div className="text-sm text-muted-foreground bg-muted p-4 rounded-lg border border-border/50 text-center space-y-3">
                <p>Sign in to save routes and reach them from any device.</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => setLocation("/sign-in")}
                >
                  <LogIn className="mr-2 h-4 w-4" /> Sign in
                </Button>
              </div>
            </Show>
            <Show when="signed-in">
              {isLoadingSavedRoutes ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading saved routes...
                </div>
              ) : !savedRoutes || savedRoutes.length === 0 ? (
                <div className="text-sm text-muted-foreground bg-muted p-4 rounded-lg border border-border/50 text-center">
                  No saved routes yet. Plan a route and tap "Save route" to keep it.
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
                          {formatDistance(route.distanceMeters)} · {route.nodeRefs.length} nodes
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Open route"
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
                        title="Rename route"
                        onClick={() => openRenameDialog({ id: route.id, name: route.name })}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        title="Delete route"
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
            <h3 className="text-sm font-semibold text-muted-foreground">Import & Export</h3>
            <div className="grid grid-cols-2 gap-2">
              <Button 
                variant="outline" 
                className="w-full" 
                disabled={!routePlan?.coordinates?.length}
                onClick={handleExportGPX}
              >
                <Download className="mr-2 h-4 w-4" /> Export GPX
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
                <Upload className="mr-2 h-4 w-4" /> Import GPX
              </Button>
            </div>
            {importedCoordinates && (
              <div className="text-xs text-muted-foreground flex justify-between items-center bg-muted p-2 rounded">
                <span>GPX track loaded</span>
                <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setImportedCoordinates(null)}>Clear</Button>
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
          onBboxChange={setBbox}
          onNodeClick={handleNodeClick}
          flyToRegion={flyToRegion}
          initialBounds={initialBounds}
          fitBounds={fitBounds}
        />
      </div>

      {/* Save Route Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save route</DialogTitle>
            <DialogDescription>
              Give your route a name so you can reopen it later.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="e.g. Sunday loop along the Maas"
            value={routeName}
            onChange={(e) => setRouteName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitSaveRoute();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitSaveRoute} disabled={!routeName.trim() || isSavingRoute}>
              {isSavingRoute ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save
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
            <DialogTitle>Rename route</DialogTitle>
            <DialogDescription>
              Update the name of your saved route.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Route name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRenameRoute();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submitRenameRoute} disabled={!renameValue.trim() || isRenamingRoute}>
              {isRenamingRoute ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Pencil className="mr-2 h-4 w-4" />
              )}
              Rename
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
            <DialogTitle>Import routes from this device?</DialogTitle>
            <DialogDescription>
              We found cycling routes you saved on this device before signing in.
              Import them into your account so you can reach them from anywhere.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={dismissClaim}
              disabled={isClaiming}
            >
              Not now
            </Button>
            <Button onClick={handleClaimRoutes} disabled={isClaiming}>
              {isClaiming ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Import routes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import React, { useRef } from "react";
import { 
  MapPin, 
  Download, 
  Upload, 
  Trash2, 
  Undo2, 
  Navigation,
  Compass,
  Map as MapIcon,
  Loader2,
  AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useRoutePlanner } from "@/hooks/use-route-planner";
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
    flyToRegion,
    setFlyToRegion,
    handleNodeClick,
    handleUndo,
    handleClear
  } = useRoutePlanner();

  const fileInputRef = useRef<HTMLInputElement>(null);

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
          setImportedCoordinates(coords);
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
          <div className="flex items-center gap-2 mb-1">
            <MapIcon className="h-6 w-6" />
            <h1 className="text-xl font-bold tracking-tight">Fietsrouteplanner</h1>
          </div>
          <p className="text-sm opacity-90">Plan your cycling adventure in NL/BE</p>
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
                  <div className="bg-secondary/50 rounded-lg p-4 border border-secondary-border flex flex-col gap-2">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground font-medium">Total Distance:</span>
                      <span className="font-bold text-lg text-foreground">{formatDistance(routePlan.distanceMeters)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
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
        />
      </div>
    </div>
  );
}

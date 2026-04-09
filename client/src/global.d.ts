declare namespace google {
  namespace maps {
    class Map {
      constructor(element: HTMLElement, options?: any);
      setCenter(latLng: any): void;
      panTo(latLng: any): void;
      setZoom(zoom: number): void;
      getZoom(): number;
      getBounds(): LatLngBounds | undefined;
      fitBounds(bounds: LatLngBounds, padding?: number | any): void;
      setOptions(options: any): void;
      addListener(event: string, handler: (...args: any[]) => void): MapsEventListener;
    }
    class Marker {
      constructor(options?: any);
      setMap(map: Map | null): void;
      setPosition(pos: any): void;
      setIcon(icon: any): void;
      getTitle(): string | undefined;
      addListener(event: string, handler: (...args: any[]) => void): MapsEventListener;
      getPosition(): LatLng | null;
    }
    class Circle {
      constructor(options?: any);
      setMap(map: Map | null): void;
      setCenter(center: any): void;
      setRadius(radius: number): void;
      getBounds(): LatLngBounds | undefined;
    }
    class Polyline {
      constructor(options?: any);
      setMap(map: Map | null): void;
      setPath(path: any[]): void;
    }
    class InfoWindow {
      constructor(options?: any);
      open(mapOrOptions?: any, anchor?: any): void;
      close(): void;
      setContent(content: string | Node): void;
    }
    class LatLng {
      constructor(lat: number, lng: number);
      lat(): number;
      lng(): number;
    }
    class LatLngBounds {
      constructor(sw?: LatLng, ne?: LatLng);
      extend(point: LatLng | { lat: number; lng: number }): LatLngBounds;
    }
    interface MapsEventListener {
      remove(): void;
    }
    interface MapMouseEvent {
      latLng: LatLng | null;
    }
    namespace places {
      class AutocompleteService {
        getPlacePredictions(
          request: any,
          callback: (results: AutocompletePrediction[] | null, status: string) => void
        ): void;
      }
      class PlacesService {
        constructor(attrContainer: HTMLElement);
        getDetails(
          request: any,
          callback: (place: any, status: string) => void
        ): void;
      }
      class Autocomplete {
        constructor(input: HTMLInputElement, options?: any);
        addListener(event: string, handler: () => void): MapsEventListener;
        getPlace(): any;
        setBounds(bounds: LatLngBounds): void;
        bindTo(key: string, target: any): void;
      }
      interface AutocompletePrediction {
        description: string;
        place_id: string;
        structured_formatting: {
          main_text: string;
          secondary_text: string;
        };
        types: string[];
      }
      const PlacesServiceStatus: {
        OK: string;
        ZERO_RESULTS: string;
        ERROR: string;
      };
    }
    const MapTypeControlStyle: {
      DEFAULT: any;
      HORIZONTAL_BAR: any;
      DROPDOWN_MENU: any;
    };
    const ControlPosition: {
      TOP_LEFT: any;
      TOP_CENTER: any;
      TOP_RIGHT: any;
      LEFT_TOP: any;
      LEFT_CENTER: any;
      LEFT_BOTTOM: any;
      RIGHT_TOP: any;
      RIGHT_CENTER: any;
      RIGHT_BOTTOM: any;
      BOTTOM_LEFT: any;
      BOTTOM_CENTER: any;
      BOTTOM_RIGHT: any;
    };
    const SymbolPath: {
      CIRCLE: any;
      FORWARD_CLOSED_ARROW: any;
      FORWARD_OPEN_ARROW: any;
      BACKWARD_CLOSED_ARROW: any;
      BACKWARD_OPEN_ARROW: any;
    };
    namespace geometry {
      namespace spherical {
        function computeDistanceBetween(from: LatLng, to: LatLng): number;
        function interpolate(from: LatLng, to: LatLng, fraction: number): LatLng;
      }
    }
    namespace event {
      function addListener(instance: any, eventName: string, handler: (...args: any[]) => void): MapsEventListener;
      function removeListener(listener: MapsEventListener): void;
      function trigger(instance: any, eventName: string, ...args: any[]): void;
    }
  }
}

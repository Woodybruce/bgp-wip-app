import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ImageStudioImage } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Upload,
  Search,
  Image as ImageIconLucide,
  Trash2,
  Edit,
  Download,
  Tag,
  Sparkles,
  MapPin,
  Building2,
  Grid3X3,
  List,
  Filter,
  X,
  Loader2,
  Camera,
  Globe,
  FolderOpen,
  Eye,
  Maximize2,
  Plus,
  Wand2,
  StretchHorizontal,
  FolderPlus,
  Library,
  Link,
} from "lucide-react";
import { PageLayout } from "@/components/page-layout";
import { EmptyState } from "@/components/empty-state";

const CATEGORIES = [
  "All",
  "Brands",
  "Properties",
  "Areas",
  "Marketing",
  "Events",
  "Headshots",
  "Floor Plans",
  "Interiors",
  "Exteriors",
  "Street Views",
  "Generated",
  "Stock",
  "Uncategorised",
  "Other",
];

const PROPERTY_TYPES = [
  "Retail",
  "Office",
  "Industrial",
  "Mixed Use",
  "F&B",
  "Leisure",
  "Residential",
];

const BRAND_SECTORS = [
  "Retailer",
  "Restaurant",
  "Coffee / Café",
  "F&B",
  "Leisure",
  "Gym / Fitness",
  "Wellness / Beauty",
  "Fashion",
  "Grocery",
  "Services",
  "Office Occupier",
  "Hotel",
  "Other",
];

export default function ImageStudio() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchString = useSearch();
  const queryParams = new URLSearchParams(searchString);
  const linkedProperty = queryParams.get("property") || "";
  const linkedAddress = queryParams.get("address") || "";
  const linkedPropertyId = queryParams.get("propertyId") || "";

  const [activeTab, setActiveTab] = useState("library");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedImage, setSelectedImage] = useState<ImageStudioImage | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [streetViewDialogOpen, setStreetViewDialogOpen] = useState(false);
  const [stockSearchOpen, setStockSearchOpen] = useState(false);

  const [uploadCategory, setUploadCategory] = useState("Uncategorised");
  const [uploadArea, setUploadArea] = useState("");
  const [uploadTags, setUploadTags] = useState("");
  const [uploadAddress, setUploadAddress] = useState("");
  const [uploadBrandName, setUploadBrandName] = useState("");
  const [uploadPropertyType, setUploadPropertyType] = useState("");

  const [activeSection, setActiveSection] = useState<"library" | "brands">("library");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const [brandSearchQuery, setBrandSearchQuery] = useState("");
  const [brandSectorFilter, setBrandSectorFilter] = useState("All");
  const [propertyTypeFilter, setPropertyTypeFilter] = useState("All");
  const [areaFilter, setAreaFilter] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [uploadBrandSector, setUploadBrandSector] = useState("");

  const [streetViewAddress, setStreetViewAddress] = useState("");

  useEffect(() => {
    if (linkedAddress) {
      setStreetViewAddress(linkedAddress);
    }
    if (linkedProperty) {
      setSearchQuery(linkedProperty);
    }
  }, [linkedAddress, linkedProperty]);
  const [streetViewHeading, setStreetViewHeading] = useState(0);
  const [streetViewPitch, setStreetViewPitch] = useState(0);
  const [streetViewFov, setStreetViewFov] = useState(90);
  const [streetViewPreviewUrl, setStreetViewPreviewUrl] = useState("");

  const [stockQuery, setStockQuery] = useState("");
  const [stockResults, setStockResults] = useState<any[]>([]);
  const [stockLoading, setStockLoading] = useState(false);

  const [aiGenerateOpen, setAiGenerateOpen] = useState(false);
  const [aiGeneratePrompt, setAiGeneratePrompt] = useState("");
  const [aiGenerateCategory, setAiGenerateCategory] = useState("Generated");
  const [aiGenerateArea, setAiGenerateArea] = useState("");

  const [aiEditOpen, setAiEditOpen] = useState(false);
  const [aiEditPrompt, setAiEditPrompt] = useState("");
  const [aiEditImageId, setAiEditImageId] = useState<string | null>(null);
  const [aiEditImageName, setAiEditImageName] = useState("");

  // Bulk tag state
  const [bulkTagDialogOpen, setBulkTagDialogOpen] = useState(false);
  const [bulkTagInput, setBulkTagInput] = useState("");

  // Bulk assign property state
  const [bulkPropertyDialogOpen, setBulkPropertyDialogOpen] = useState(false);
  const [bulkPropertyId, setBulkPropertyId] = useState("");
  const [bulkPropertyAddress, setBulkPropertyAddress] = useState("");

  // Collections state
  const [collectionsTab, setCollectionsTab] = useState<"grid" | "collections">("grid");
  const [createCollectionOpen, setCreateCollectionOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionDesc, setNewCollectionDesc] = useState("");
  const [viewingCollectionId, setViewingCollectionId] = useState<string | null>(null);
  const [addToCollectionOpen, setAddToCollectionOpen] = useState(false);
  const [addToCollectionTargetId, setAddToCollectionTargetId] = useState("");

  const [editForm, setEditForm] = useState({
    fileName: "",
    category: "",
    tags: "",
    description: "",
    area: "",
    address: "",
    brandName: "",
    brandSector: "",
    propertyType: "",
  });

  const { data: images = [], isLoading } = useQuery<ImageStudioImage[]>({
    queryKey: ["/api/image-studio"],
  });

  const { data: categories = [] } = useQuery<{ category: string; count: number }[]>({
    queryKey: ["/api/image-studio/categories"],
  });

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch("/api/image-studio/upload", {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/categories"] });
      setUploadDialogOpen(false);
      toast({ title: "Upload Complete", description: "Images uploaded successfully" });
    },
    onError: (e: Error) => toast({ title: "Upload Failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/image-studio/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/categories"] });
      setEditDialogOpen(false);
      toast({ title: "Updated", description: "Image details updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/image-studio/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/categories"] });
      setSelectedImage(null);
      setLightboxOpen(false);
      toast({ title: "Deleted", description: "Image removed from library" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await apiRequest("POST", "/api/image-studio/bulk-delete", { ids });
    },
    onSuccess: (_data: unknown, variables: { ids: string[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/categories"] });
      const count = variables.ids.length;
      setSelectedIds(new Set());
      setSelectMode(false);
      toast({ title: "Deleted", description: `${count} images removed` });
    },
  });

  const bulkCategorizeMutation = useMutation({
    mutationFn: async ({ ids, category }: { ids: string[]; category: string }) => {
      await apiRequest("PATCH", "/api/image-studio/bulk-categorize", { ids, category });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/categories"] });
      setSelectedIds(new Set());
      setSelectMode(false);
      setBulkCategory("");
      toast({ title: "Categorised", description: `${selectedIds.size} images updated` });
    },
  });

  const bulkTagMutation = useMutation({
    mutationFn: async ({ ids, tags }: { ids: string[]; tags: string[] }) => {
      await apiRequest("POST", "/api/image-studio/bulk-tag", { ids, tags });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      setBulkTagDialogOpen(false);
      setBulkTagInput("");
      toast({ title: "Tagged", description: `Tags applied to ${selectedIds.size} images` });
    },
    onError: (e: Error) => toast({ title: "Tag Failed", description: e.message, variant: "destructive" }),
  });

  const bulkAssignPropertyMutation = useMutation({
    mutationFn: async ({ ids, propertyId, address }: { ids: string[]; propertyId: string; address?: string }) => {
      await apiRequest("POST", "/api/image-studio/bulk-assign-property", { ids, propertyId, address });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      setBulkPropertyDialogOpen(false);
      setBulkPropertyId("");
      setBulkPropertyAddress("");
      toast({ title: "Assigned", description: `${selectedIds.size} images assigned to property` });
    },
    onError: (e: Error) => toast({ title: "Assign Failed", description: e.message, variant: "destructive" }),
  });

  // Properties list for the assign dialog
  const { data: properties = [] } = useQuery<any[]>({
    queryKey: ["/api/projects"],
  });

  // Collections queries
  const { data: collections = [], isLoading: collectionsLoading } = useQuery<any[]>({
    queryKey: ["/api/image-studio/collections"],
  });

  const { data: viewingCollection, isLoading: viewingCollectionLoading } = useQuery<any>({
    queryKey: ["/api/image-studio/collections", viewingCollectionId],
    enabled: !!viewingCollectionId,
  });

  const createCollectionMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      const res = await apiRequest("POST", "/api/image-studio/collections", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/collections"] });
      setCreateCollectionOpen(false);
      setNewCollectionName("");
      setNewCollectionDesc("");
      toast({ title: "Created", description: "Collection created" });
    },
    onError: (e: Error) => toast({ title: "Create Failed", description: e.message, variant: "destructive" }),
  });

  const addToCollectionMutation = useMutation({
    mutationFn: async ({ collectionId, imageIds }: { collectionId: string; imageIds: string[] }) => {
      const res = await apiRequest("POST", `/api/image-studio/collections/${collectionId}/images`, { imageIds });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/collections"] });
      if (viewingCollectionId) {
        queryClient.invalidateQueries({ queryKey: ["/api/image-studio/collections", viewingCollectionId] });
      }
      setAddToCollectionOpen(false);
      setAddToCollectionTargetId("");
      setSelectedIds(new Set());
      setSelectMode(false);
      toast({ title: "Added", description: "Images added to collection" });
    },
    onError: (e: Error) => toast({ title: "Add Failed", description: e.message, variant: "destructive" }),
  });

  const deleteCollectionMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/image-studio/collections/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/collections"] });
      setViewingCollectionId(null);
      toast({ title: "Deleted", description: "Collection deleted" });
    },
  });

  const removeFromCollectionMutation = useMutation({
    mutationFn: async ({ collectionId, imageId }: { collectionId: string; imageId: string }) => {
      await apiRequest("DELETE", `/api/image-studio/collections/${collectionId}/images/${imageId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/collections"] });
      if (viewingCollectionId) {
        queryClient.invalidateQueries({ queryKey: ["/api/image-studio/collections", viewingCollectionId] });
      }
      toast({ title: "Removed", description: "Image removed from collection" });
    },
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const aiTagMutation = useMutation({
    mutationFn: async (imageId: string) => {
      const res = await apiRequest("POST", "/api/image-studio/ai-tag", { imageId });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      toast({ title: "AI Tagged", description: `Categorised as "${data.category}" with ${data.tags?.length || 0} tags` });
    },
    onError: (e: Error) => toast({ title: "AI Tag Failed", description: e.message, variant: "destructive" }),
  });

  const importStockMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/image-studio/import-stock", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/categories"] });
      toast({ title: "Imported", description: "Stock image added to library" });
    },
  });

  const aiGenerateMutation = useMutation({
    mutationFn: async (data: { prompt: string; category: string; area?: string }) => {
      const res = await apiRequest("POST", "/api/image-studio/ai-generate", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/categories"] });
      toast({ title: "Generated", description: "AI image created and added to library" });
      setAiGenerateOpen(false);
      setAiGeneratePrompt("");
    },
    onError: (err: any) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  const aiEditMutation = useMutation({
    mutationFn: async (data: { imageId: string; editPrompt: string }) => {
      const res = await apiRequest("POST", "/api/image-studio/ai-edit", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/categories"] });
      toast({ title: "Edited", description: "AI touch-up created as new image" });
      setAiEditOpen(false);
      setAiEditPrompt("");
      setAiEditImageId(null);
    },
    onError: (err: any) => {
      toast({ title: "Edit failed", description: err.message, variant: "destructive" });
    },
  });

  const filteredImages = images.filter((img) => {
    if (selectedCategory !== "All" && img.category !== selectedCategory) return false;
    if (propertyTypeFilter !== "All" && (img as any).propertyType !== propertyTypeFilter) return false;
    if (areaFilter) {
      const af = areaFilter.toLowerCase();
      if (!img.area?.toLowerCase().includes(af) && !(img as any).address?.toLowerCase().includes(af)) return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        img.fileName?.toLowerCase().includes(q) ||
        img.description?.toLowerCase().includes(q) ||
        img.area?.toLowerCase().includes(q) ||
        (img as any).address?.toLowerCase().includes(q) ||
        (img as any).brandName?.toLowerCase().includes(q) ||
        img.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const brandImages = images.filter((img) => {
    if (img.category !== "Brands") return false;
    if (brandSectorFilter !== "All" && (img as any).brandSector !== brandSectorFilter) return false;
    if (brandSearchQuery) {
      const q = brandSearchQuery.toLowerCase();
      return (
        img.fileName?.toLowerCase().includes(q) ||
        (img as any).brandName?.toLowerCase().includes(q) ||
        img.description?.toLowerCase().includes(q) ||
        img.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const headshotImages = images.filter((img) => img.category === "Headshots");
  const peopleGroups = (() => {
    const groups: Record<string, ImageStudioImage[]> = {};
    for (const img of headshotImages) {
      const nameTags = (img.tags || []).filter(
        (t) => !["People", "BGP Business Context", "Headshots", "Portrait", "Staff", "Team"].includes(t)
      );
      let personName: string;
      if (nameTags.length > 0) {
        personName = nameTags[0];
      } else {
        const desc = img.description || "";
        const pathParts = desc.replace(/^Imported from SharePoint:\s*/i, "").split("/");
        if (pathParts.length >= 3) {
          const folder = pathParts[pathParts.length - 2];
          personName = folder || "Untagged";
        } else {
          personName = "Untagged";
        }
      }
      if (!groups[personName]) groups[personName] = [];
      groups[personName].push(img);
    }
    return Object.entries(groups)
      .map(([name, imgs]) => ({ name, images: imgs, coverImage: imgs[0], count: imgs.length }))
      .sort((a, b) => {
        if (a.name === "Untagged") return 1;
        if (b.name === "Untagged") return -1;
        return a.name.localeCompare(b.name);
      });
  })();

  const handleUpload = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const formData = new FormData();
      Array.from(files).forEach((f) => formData.append("images", f));
      formData.append("category", uploadCategory);
      formData.append("area", uploadArea);
      formData.append("tags", uploadTags);
      if (uploadAddress) formData.append("address", uploadAddress);
      if (uploadBrandName) formData.append("brandName", uploadBrandName);
      if (uploadBrandSector && uploadBrandSector !== "none") formData.append("brandSector", uploadBrandSector);
      if (uploadPropertyType) formData.append("propertyType", uploadPropertyType);
      uploadMutation.mutate(formData);
    },
    [uploadCategory, uploadArea, uploadTags, uploadAddress, uploadBrandName, uploadBrandSector, uploadPropertyType, uploadMutation]
  );

  const handleStreetViewPreview = useCallback(() => {
    if (!streetViewAddress.trim()) return;
    const params = new URLSearchParams({
      location: streetViewAddress,
      heading: String(streetViewHeading),
      pitch: String(streetViewPitch),
      fov: String(streetViewFov),
    });
    setStreetViewPreviewUrl(`/api/image-studio/streetview-proxy?${params}`);
  }, [streetViewAddress, streetViewHeading, streetViewPitch, streetViewFov]);

  const captureStreetViewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/image-studio/capture-streetview", {
        location: streetViewAddress,
        heading: streetViewHeading,
        pitch: streetViewPitch,
        fov: streetViewFov,
        area: streetViewAddress,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/categories"] });
      setStreetViewDialogOpen(false);
      toast({ title: "Captured", description: "Street View image saved to library" });
    },
    onError: (e: Error) => toast({ title: "Capture Failed", description: e.message, variant: "destructive" }),
  });

  const handleStockSearch = useCallback(async () => {
    if (!stockQuery.trim()) return;
    setStockLoading(true);
    try {
      const res = await apiRequest("POST", "/api/image-studio/stock-search", { query: stockQuery });
      const data = await res.json();
      setStockResults(data.results || []);
      if (data.message) toast({ title: "Note", description: data.message });
    } catch (e: any) {
      toast({ title: "Search Failed", description: e.message, variant: "destructive" });
    } finally {
      setStockLoading(false);
    }
  }, [stockQuery, toast]);

  const openEdit = (img: ImageStudioImage) => {
    setEditForm({
      fileName: img.fileName || "",
      category: img.category || "Uncategorised",
      tags: (img.tags || []).join(", "),
      description: img.description || "",
      area: img.area || "",
      address: (img as any).address || "",
      brandName: (img as any).brandName || "",
      brandSector: (img as any).brandSector || "",
      propertyType: (img as any).propertyType || "",
    });
    setSelectedImage(img);
    setEditDialogOpen(true);
  };

  const categoryCounts = categories.reduce((acc, c) => {
    acc[c.category] = c.count;
    return acc;
  }, {} as Record<string, number>);

  return (
    <PageLayout
      title={`Image Studio${linkedProperty ? ` — ${linkedProperty}` : ""}`}
      subtitle={linkedProperty ? "Linked from property" : "Manage images, brands, street views and AI generation"}
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAiGenerateOpen(true)}
            data-testid="button-ai-generate"
          >
            <Sparkles className="h-4 w-4 mr-1" />
            AI Generate
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStreetViewDialogOpen(true)}
            data-testid="button-street-view"
          >
            <MapPin className="h-4 w-4 mr-1" />
            Street View
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStockSearchOpen(true)}
            data-testid="button-stock-search"
          >
            <Globe className="h-4 w-4 mr-1" />
            Stock Photos
          </Button>
          <Button
            size="sm"
            onClick={() => setUploadDialogOpen(true)}
            data-testid="button-upload"
          >
            <Upload className="h-4 w-4 mr-1" />
            Upload
          </Button>
        </>
      }
      fullHeight
      testId="image-studio-page"
    >
      {/* Section tabs */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-background flex-shrink-0">
        <button
          onClick={() => { setActiveSection("library"); setCollectionsTab("grid"); setSelectMode(false); setSelectedIds(new Set()); }}
          className={`text-sm px-2 py-0.5 rounded ${activeSection === "library" && collectionsTab === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          data-testid="tab-library"
        >
          Library ({images.filter(i => i.category !== "Brands").length})
        </button>
        <button
          onClick={() => { setActiveSection("brands"); setCollectionsTab("grid"); setSelectMode(false); setSelectedIds(new Set()); }}
          className={`text-sm px-2 py-0.5 rounded ${activeSection === "brands" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          data-testid="tab-brands"
        >
          Brand Library ({images.filter(i => i.category === "Brands").length})
        </button>
        <button
          onClick={() => { setActiveSection("library"); setCollectionsTab("collections"); setSelectMode(false); setSelectedIds(new Set()); }}
          className={`text-sm px-2 py-0.5 rounded ${collectionsTab === "collections" && activeSection === "library" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          data-testid="tab-collections"
        >
          Collections ({collections.length})
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {activeSection === "library" ? (
        <div className="w-56 border-r p-3 overflow-y-auto hidden md:block">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Categories</h3>
          <div className="space-y-0.5">
            {CATEGORIES.filter(c => c !== "Brands").map((cat) => (
              <button
                key={cat}
                onClick={() => { setSelectedCategory(cat); setSelectedPerson(null); }}
                className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center justify-between transition-colors ${
                  selectedCategory === cat
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
                data-testid={`button-category-${cat.toLowerCase().replace(/\s/g, "-")}`}
              >
                <span>{cat}</span>
                {cat !== "All" && categoryCounts[cat] ? (
                  <span className="text-xs opacity-70">{categoryCounts[cat]}</span>
                ) : cat === "All" ? (
                  <span className="text-xs opacity-70">{images.filter(i => i.category !== "Brands").length}</span>
                ) : null}
              </button>
            ))}
          </div>
          {selectedCategory === "Properties" && (
            <>
              <Separator className="my-3" />
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Property Type</h3>
              <div className="space-y-0.5">
                {["All", ...PROPERTY_TYPES].map((pt) => (
                  <button
                    key={pt}
                    onClick={() => setPropertyTypeFilter(pt)}
                    className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                      propertyTypeFilter === pt ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                    }`}
                    data-testid={`button-proptype-${pt.toLowerCase().replace(/\s/g, "-")}`}
                  >
                    {pt}
                  </button>
                ))}
              </div>
              <Separator className="my-3" />
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Area Filter</h3>
              <Input
                placeholder="Filter by area..."
                value={areaFilter}
                onChange={(e) => setAreaFilter(e.target.value)}
                className="h-8 text-sm"
                data-testid="input-area-filter"
              />
            </>
          )}
        </div>
        ) : null}

        <div className="flex-1 flex flex-col overflow-hidden">
          {activeSection === "brands" ? (
          <>
            <div className="flex flex-col gap-2 p-3 border-b">
              <div className="flex items-center gap-2">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search brands, retailers, restaurants..."
                    value={brandSearchQuery}
                    onChange={(e) => setBrandSearchQuery(e.target.value)}
                    className="pl-8 h-9"
                    data-testid="input-brand-search"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => { setUploadCategory("Brands"); setUploadDialogOpen(true); }}
                  data-testid="button-upload-brand"
                >
                  <Upload className="h-4 w-4 mr-1" /> Add Brand
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {["All", ...BRAND_SECTORS].map((sector) => {
                  const count = sector === "All"
                    ? images.filter(i => i.category === "Brands").length
                    : images.filter(i => i.category === "Brands" && (i as any).brandSector === sector).length;
                  return (
                    <button
                      key={sector}
                      onClick={() => setBrandSectorFilter(sector)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                        brandSectorFilter === sector
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                      data-testid={`button-brand-sector-${sector.toLowerCase().replace(/[\s\/]/g, "-")}`}
                    >
                      {sector} {count > 0 && <span className="opacity-70">({count})</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <ScrollArea className="flex-1 p-3">
              {brandImages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Building2 className="h-12 w-12 text-muted-foreground/30 mb-3" />
                  <p className="text-lg font-medium text-muted-foreground mb-1">Brand Library</p>
                  <p className="text-muted-foreground text-sm max-w-md">
                    {brandSearchQuery
                      ? "No brands match your search"
                      : "Upload logos and images of retailers, restaurants, and occupiers. Build your brand library for leasing proposals and marketing."}
                  </p>
                  <Button size="sm" className="mt-4" onClick={() => { setUploadCategory("Brands"); setUploadDialogOpen(true); }} data-testid="button-upload-brand-empty">
                    <Upload className="h-4 w-4 mr-1" /> Add First Brand
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {brandImages.map((img) => (
                    <ImageCard
                      key={img.id}
                      image={img}
                      onView={() => { setSelectedImage(img); setLightboxOpen(true); }}
                      onEdit={() => openEdit(img)}
                      onAiTag={() => aiTagMutation.mutate(img.id)}
                      onAiEdit={() => {
                        setAiEditImageId(img.id);
                        setAiEditImageName(img.fileName || "");
                        setAiEditPrompt("");
                        setAiEditOpen(true);
                      }}
                      onDelete={() => { if (confirm("Delete this brand image?")) deleteMutation.mutate(img.id); }}
                      selectMode={selectMode}
                      selected={selectedIds.has(img.id)}
                      onToggleSelect={() => toggleSelect(img.id)}
                      aiTagging={aiTagMutation.isPending}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </>
          ) : (
          <>
          {collectionsTab === "grid" && (<>
          <div className="flex items-center gap-2 p-3 border-b">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search images, addresses..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-9"
                data-testid="input-search"
              />
            </div>
            <Select value={selectedCategory} onValueChange={(v) => { setSelectedCategory(v); setSelectedPerson(null); }}>
              <SelectTrigger className="w-40 h-9 md:hidden" data-testid="select-category-mobile">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.filter(c => c !== "Brands").map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={selectMode ? "default" : "outline"}
              size="sm"
              className="h-9"
              onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()); }}
              data-testid="button-select-mode"
            >
              {selectMode ? <X className="h-4 w-4 mr-1" /> : <StretchHorizontal className="h-4 w-4 mr-1" />}
              {selectMode ? "Cancel" : "Select"}
            </Button>
            <div className="flex border rounded-md">
              <Button
                variant={viewMode === "grid" ? "default" : "ghost"}
                size="sm"
                className="h-9 px-2 rounded-r-none"
                onClick={() => setViewMode("grid")}
                data-testid="button-view-grid"
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "ghost"}
                size="sm"
                className="h-9 px-2 rounded-l-none"
                onClick={() => setViewMode("list")}
                data-testid="button-view-list"
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {selectMode && (
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (selectedIds.size === filteredImages.length) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(filteredImages.map(i => i.id)));
                  }
                }}
                data-testid="button-select-all"
              >
                {selectedIds.size === filteredImages.length && selectedIds.size > 0 ? "Deselect All" : "Select All"}
              </Button>
              <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
              <div className="flex-1" />
              {selectedIds.size > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setBulkTagInput(""); setBulkTagDialogOpen(true); }}
                    data-testid="button-bulk-tag"
                  >
                    <Tag className="h-4 w-4 mr-1" />
                    Tag All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setBulkPropertyId(""); setBulkPropertyAddress(""); setBulkPropertyDialogOpen(true); }}
                    data-testid="button-bulk-assign-property"
                  >
                    <Building2 className="h-4 w-4 mr-1" />
                    Assign to Property
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setAddToCollectionTargetId(""); setAddToCollectionOpen(true); }}
                    data-testid="button-add-to-collection"
                  >
                    <FolderPlus className="h-4 w-4 mr-1" />
                    Add to Collection
                  </Button>
                  <div className="flex items-center gap-1.5">
                    <Select value={bulkCategory} onValueChange={setBulkCategory}>
                      <SelectTrigger className="h-8 w-[150px] text-xs" data-testid="select-bulk-category">
                        <SelectValue placeholder="Move to..." />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.filter(c => c !== "All").map(c => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!bulkCategory || bulkCategorizeMutation.isPending}
                      onClick={() => bulkCategorizeMutation.mutate({ ids: [...selectedIds], category: bulkCategory })}
                      data-testid="button-bulk-categorize"
                    >
                      {bulkCategorizeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Tag className="h-4 w-4 mr-1" />}
                      Categorise
                    </Button>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={bulkDeleteMutation.isPending}
                    onClick={() => {
                      if (confirm(`Delete ${selectedIds.size} images? This cannot be undone.`)) {
                        bulkDeleteMutation.mutate([...selectedIds]);
                      }
                    }}
                    data-testid="button-bulk-delete"
                  >
                    {bulkDeleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
                    Delete {selectedIds.size}
                  </Button>
                </>
              )}
            </div>
          )}
          </>)}

          {collectionsTab === "collections" ? (
          <ScrollArea className="flex-1 p-3">
            {viewingCollectionId ? (
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <button
                    onClick={() => setViewingCollectionId(null)}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                    data-testid="button-back-to-collections"
                  >
                    ← Collections
                  </button>
                  <span className="text-muted-foreground">/</span>
                  <h3 className="text-lg font-semibold" data-testid="text-collection-name">{viewingCollection?.name || "Loading..."}</h3>
                  {viewingCollection?.description && (
                    <span className="text-sm text-muted-foreground ml-2">{viewingCollection.description}</span>
                  )}
                  <div className="flex-1" />
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (confirm("Delete this collection? Images won't be deleted.")) {
                        deleteCollectionMutation.mutate(viewingCollectionId);
                      }
                    }}
                    data-testid="button-delete-collection"
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Delete Collection
                  </Button>
                </div>
                {viewingCollectionLoading ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="aspect-square rounded-lg" />
                    ))}
                  </div>
                ) : !viewingCollection?.images?.length ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <FolderOpen className="h-12 w-12 text-muted-foreground/30 mb-3" />
                    <p className="text-muted-foreground text-sm">This collection is empty. Select images and add them here.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {viewingCollection.images.map((img: any) => {
                      const imageObj = {
                        id: img.id,
                        fileName: img.file_name,
                        category: img.category,
                        tags: img.tags,
                        description: img.description,
                        source: img.source,
                        propertyId: img.property_id,
                        area: img.area,
                        address: img.address,
                        brandName: img.brand_name,
                        brandSector: img.brand_sector,
                        propertyType: img.property_type,
                        mimeType: img.mime_type,
                        fileSize: img.file_size,
                        width: img.width,
                        height: img.height,
                        thumbnailData: img.thumbnail_data,
                        sharepointItemId: img.sharepoint_item_id,
                        sharepointDriveId: img.sharepoint_drive_id,
                        localPath: img.local_path,
                        uploadedBy: img.uploaded_by,
                        createdAt: img.created_at,
                      };
                      return (
                        <div key={img.id} className="relative group">
                          <ImageCard
                            image={imageObj as any}
                            onView={() => { setSelectedImage(imageObj as any); setLightboxOpen(true); }}
                            onEdit={() => openEdit(imageObj as any)}
                            onAiTag={() => aiTagMutation.mutate(img.id)}
                            onAiEdit={() => { setAiEditImageId(img.id); setAiEditImageName(img.file_name || ""); setAiEditPrompt(""); setAiEditOpen(true); }}
                            onDelete={() => {
                              if (confirm("Remove from collection?")) {
                                removeFromCollectionMutation.mutate({ collectionId: viewingCollectionId!, imageId: img.id });
                              }
                            }}
                            aiTagging={aiTagMutation.isPending}
                            selectMode={false}
                            selected={false}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold" data-testid="text-collections-title">Collections</h3>
                    <p className="text-sm text-muted-foreground">{collections.length} {collections.length === 1 ? "collection" : "collections"}</p>
                  </div>
                  <Button size="sm" onClick={() => setCreateCollectionOpen(true)} data-testid="button-create-collection">
                    <Plus className="h-4 w-4 mr-1" /> New Collection
                  </Button>
                </div>
                {collectionsLoading ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-48 rounded-lg" />
                    ))}
                  </div>
                ) : collections.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Library className="h-12 w-12 text-muted-foreground/30 mb-3" />
                    <p className="text-lg font-medium text-muted-foreground mb-1">No Collections Yet</p>
                    <p className="text-muted-foreground text-sm max-w-md">
                      Create collections to organise your images into themed groups — e.g. "Q4 Marketing", "Mayfair Properties", or "Client Presentation".
                    </p>
                    <Button size="sm" className="mt-4" onClick={() => setCreateCollectionOpen(true)} data-testid="button-create-collection-empty">
                      <Plus className="h-4 w-4 mr-1" /> Create First Collection
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {collections.map((col: any) => (
                      <div
                        key={col.id}
                        className="group rounded-lg border bg-card overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                        onClick={() => setViewingCollectionId(col.id)}
                        data-testid={`card-collection-${col.id}`}
                      >
                        <div className="aspect-video bg-muted relative">
                          {col.cover_thumbnail ? (
                            <img src={col.cover_thumbnail} alt={col.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <FolderOpen className="h-10 w-10 text-muted-foreground/30" />
                            </div>
                          )}
                          <div className="absolute top-2 right-2">
                            <Badge variant="secondary" className="text-xs">{col.image_count || 0}</Badge>
                          </div>
                        </div>
                        <div className="p-3">
                          <p className="font-medium text-sm truncate">{col.name}</p>
                          {col.description && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{col.description}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
          ) : (
          <ScrollArea className="flex-1 p-3">
            {isLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-square rounded-lg" />
                ))}
              </div>
            ) : selectedCategory === "Headshots" && !selectedPerson ? (
              <div>
                <div className="mb-4">
                  <h3 className="text-lg font-semibold" data-testid="text-people-title">Headshots</h3>
                  <p className="text-sm text-muted-foreground">{headshotImages.length} photos across {peopleGroups.length} {peopleGroups.length === 1 ? "group" : "groups"}</p>
                </div>
                {peopleGroups.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Camera className="h-12 w-12 text-muted-foreground/30 mb-3" />
                    <p className="text-muted-foreground text-sm">No headshots yet. Upload portrait photos to get started.</p>
                    <Button size="sm" className="mt-4" onClick={() => { setUploadCategory("Headshots"); setUploadDialogOpen(true); }} data-testid="button-upload-headshots">
                      <Upload className="h-4 w-4 mr-1" /> Upload Headshots
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-x-4 gap-y-6 px-2">
                    {peopleGroups.map((person) => (
                      <button
                        key={person.name}
                        onClick={() => setSelectedPerson(person.name)}
                        className="flex flex-col items-center gap-2.5 group cursor-pointer"
                        data-testid={`button-person-${person.name.toLowerCase().replace(/\s/g, "-")}`}
                      >
                        <div className="w-[100px] h-[100px] sm:w-[110px] sm:h-[110px] md:w-[120px] md:h-[120px] rounded-full overflow-hidden ring-[3px] ring-white dark:ring-gray-800 shadow-[0_1px_4px_rgba(0,0,0,0.12)] group-hover:shadow-[0_2px_12px_rgba(0,0,0,0.18)] group-hover:scale-[1.04] transition-all duration-200">
                          <img
                            src={person.coverImage.thumbnailData || `/api/image-studio/${person.coverImage.id}/full`}
                            alt={person.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </div>
                        <div className="text-center max-w-[120px]">
                          <p className="text-[13px] font-semibold text-foreground leading-tight capitalize truncate" data-testid={`text-person-name-${person.name.toLowerCase().replace(/\s/g, "-")}`}>{person.name}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{person.count}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : selectedCategory === "Headshots" && selectedPerson ? (
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <button
                    onClick={() => setSelectedPerson(null)}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                    data-testid="button-back-to-people"
                  >
                    ← Headshots
                  </button>
                  <span className="text-muted-foreground">/</span>
                  <h3 className="text-lg font-semibold capitalize" data-testid="text-person-view-name">{selectedPerson}</h3>
                  <span className="text-sm text-muted-foreground">
                    ({(peopleGroups.find(p => p.name === selectedPerson)?.count || 0)} photos)
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {(peopleGroups.find(p => p.name === selectedPerson)?.images || []).map((img) => (
                    <ImageCard
                      key={img.id}
                      image={img}
                      onView={() => { setSelectedImage(img); setLightboxOpen(true); }}
                      onEdit={() => openEdit(img)}
                      onAiTag={() => aiTagMutation.mutate(img.id)}
                      onAiEdit={() => { setAiEditImageId(img.id); setAiEditImageName(img.fileName || ""); setAiEditPrompt(""); setAiEditOpen(true); }}
                      onDelete={() => { if (confirm("Delete this image?")) deleteMutation.mutate(img.id); }}
                      aiTagging={aiTagMutation.isPending}
                      selectMode={selectMode}
                      selected={selectedIds.has(img.id)}
                      onToggleSelect={() => toggleSelect(img.id)}
                    />
                  ))}
                </div>
              </div>
            ) : filteredImages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <EmptyState
                  icon={ImageIconLucide}
                  title="No images yet"
                  description={searchQuery || selectedCategory !== "All"
                    ? "No images match your filters"
                    : "Upload images or capture from Street View"}
                />
                <div className="flex gap-2 mt-2">
                  <Button size="sm" onClick={() => setUploadDialogOpen(true)} data-testid="button-upload-empty">
                    <Upload className="h-4 w-4 mr-1" /> Upload Images
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAiGenerateOpen(true)} data-testid="button-ai-generate-empty">
                    <Sparkles className="h-4 w-4 mr-1" /> AI Generate
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setStreetViewDialogOpen(true)} data-testid="button-streetview-empty">
                    <MapPin className="h-4 w-4 mr-1" /> Capture Street View
                  </Button>
                </div>
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {filteredImages.map((img) => (
                  <ImageCard
                    key={img.id}
                    image={img}
                    onView={() => {
                      setSelectedImage(img);
                      setLightboxOpen(true);
                    }}
                    onEdit={() => openEdit(img)}
                    onAiTag={() => aiTagMutation.mutate(img.id)}
                    onAiEdit={() => {
                      setAiEditImageId(img.id);
                      setAiEditImageName(img.fileName || "");
                      setAiEditPrompt("");
                      setAiEditOpen(true);
                    }}
                    onDelete={() => {
                      if (confirm("Delete this image?")) deleteMutation.mutate(img.id);
                    }}
                    aiTagging={aiTagMutation.isPending}
                    selectMode={selectMode}
                    selected={selectedIds.has(img.id)}
                    onToggleSelect={() => toggleSelect(img.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {filteredImages.map((img) => (
                  <ImageListRow
                    key={img.id}
                    image={img}
                    onView={() => {
                      setSelectedImage(img);
                      setLightboxOpen(true);
                    }}
                    onEdit={() => openEdit(img)}
                    onAiTag={() => aiTagMutation.mutate(img.id)}
                    onAiEdit={() => {
                      setAiEditImageId(img.id);
                      setAiEditImageName(img.fileName || "");
                      setAiEditPrompt("");
                      setAiEditOpen(true);
                    }}
                    onDelete={() => {
                      if (confirm("Delete this image?")) deleteMutation.mutate(img.id);
                    }}
                    selectMode={selectMode}
                    selected={selectedIds.has(img.id)}
                    onToggleSelect={() => toggleSelect(img.id)}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
          )}
          </>
          )}
        </div>
      </div>

      {/* Bulk Tag Dialog */}
      <Dialog open={bulkTagDialogOpen} onOpenChange={setBulkTagDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5" /> Tag {selectedIds.size} Images
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Tags (comma separated)</Label>
              <Input
                placeholder="e.g. exterior, modern, glass, Mayfair"
                value={bulkTagInput}
                onChange={(e) => setBulkTagInput(e.target.value)}
                data-testid="input-bulk-tag"
              />
              <p className="text-xs text-muted-foreground mt-1">These tags will be added to all selected images (existing tags are kept).</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkTagDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                const tags = bulkTagInput.split(",").map(t => t.trim()).filter(Boolean);
                if (tags.length > 0) {
                  bulkTagMutation.mutate({ ids: [...selectedIds], tags });
                }
              }}
              disabled={!bulkTagInput.trim() || bulkTagMutation.isPending}
              data-testid="button-bulk-tag-submit"
            >
              {bulkTagMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Tag className="h-4 w-4 mr-1" />}
              Apply Tags
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Assign Property Dialog */}
      <Dialog open={bulkPropertyDialogOpen} onOpenChange={setBulkPropertyDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" /> Assign {selectedIds.size} Images to Property
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Property</Label>
              <Select value={bulkPropertyId} onValueChange={(v) => {
                setBulkPropertyId(v);
                const prop = properties.find((p: any) => p.id === v);
                if (prop) setBulkPropertyAddress(prop.name || prop.address || "");
              }}>
                <SelectTrigger data-testid="select-bulk-property">
                  <SelectValue placeholder="Select a property..." />
                </SelectTrigger>
                <SelectContent>
                  {properties.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Address Override (optional)</Label>
              <Input
                placeholder="Will use property name if left blank"
                value={bulkPropertyAddress}
                onChange={(e) => setBulkPropertyAddress(e.target.value)}
                data-testid="input-bulk-property-address"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkPropertyDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (bulkPropertyId) {
                  bulkAssignPropertyMutation.mutate({
                    ids: [...selectedIds],
                    propertyId: bulkPropertyId,
                    address: bulkPropertyAddress || undefined,
                  });
                }
              }}
              disabled={!bulkPropertyId || bulkAssignPropertyMutation.isPending}
              data-testid="button-bulk-assign-submit"
            >
              {bulkAssignPropertyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Link className="h-4 w-4 mr-1" />}
              Assign to Property
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add to Collection Dialog */}
      <Dialog open={addToCollectionOpen} onOpenChange={setAddToCollectionOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="h-5 w-5" /> Add {selectedIds.size} Images to Collection
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {collections.length === 0 ? (
              <p className="text-sm text-muted-foreground">No collections yet. Create one first.</p>
            ) : (
              <div>
                <Label>Collection</Label>
                <Select value={addToCollectionTargetId} onValueChange={setAddToCollectionTargetId}>
                  <SelectTrigger data-testid="select-add-to-collection">
                    <SelectValue placeholder="Select a collection..." />
                  </SelectTrigger>
                  <SelectContent>
                    {collections.map((col: any) => (
                      <SelectItem key={col.id} value={col.id}>
                        {col.name} ({col.image_count || 0} images)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setAddToCollectionOpen(false); setCreateCollectionOpen(true); }}
              data-testid="button-create-collection-from-add"
            >
              <Plus className="h-4 w-4 mr-1" /> Create New Collection
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddToCollectionOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (addToCollectionTargetId) {
                  addToCollectionMutation.mutate({
                    collectionId: addToCollectionTargetId,
                    imageIds: [...selectedIds],
                  });
                }
              }}
              disabled={!addToCollectionTargetId || addToCollectionMutation.isPending}
              data-testid="button-add-to-collection-submit"
            >
              {addToCollectionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FolderPlus className="h-4 w-4 mr-1" />}
              Add to Collection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Collection Dialog */}
      <Dialog open={createCollectionOpen} onOpenChange={setCreateCollectionOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="h-5 w-5" /> Create Collection
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Collection Name</Label>
              <Input
                placeholder="e.g. Q4 Marketing Assets, Mayfair Properties"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                data-testid="input-collection-name"
              />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Textarea
                placeholder="Brief description of this collection"
                value={newCollectionDesc}
                onChange={(e) => setNewCollectionDesc(e.target.value)}
                rows={2}
                data-testid="textarea-collection-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateCollectionOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createCollectionMutation.mutate({ name: newCollectionName, description: newCollectionDesc || undefined })}
              disabled={!newCollectionName.trim() || createCollectionMutation.isPending}
              data-testid="button-create-collection-submit"
            >
              {createCollectionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              Create Collection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" /> Upload Images
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Category</Label>
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger data-testid="select-upload-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.filter((c) => c !== "All").map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Address (optional)</Label>
              <Input
                placeholder="e.g. 10 Finsbury Square, London EC2A 1AF"
                value={uploadAddress}
                onChange={(e) => setUploadAddress(e.target.value)}
                data-testid="input-upload-address"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Area (optional)</Label>
                <Input
                  placeholder="e.g. Mayfair, City"
                  value={uploadArea}
                  onChange={(e) => setUploadArea(e.target.value)}
                  data-testid="input-upload-area"
                />
              </div>
              <div>
                <Label>Property Type</Label>
                <Select value={uploadPropertyType || "none"} onValueChange={(v) => setUploadPropertyType(v === "none" ? "" : v)}>
                  <SelectTrigger data-testid="select-upload-property-type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {PROPERTY_TYPES.map((pt) => (
                      <SelectItem key={pt} value={pt}>{pt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {uploadCategory === "Brands" && (
              <>
                <div>
                  <Label>Brand Name</Label>
                  <Input
                    placeholder="e.g. Pret A Manger, WeWork, Zara"
                    value={uploadBrandName}
                    onChange={(e) => setUploadBrandName(e.target.value)}
                    data-testid="input-upload-brand-name"
                  />
                </div>
                <div>
                  <Label>Sector</Label>
                  <Select value={uploadBrandSector} onValueChange={setUploadBrandSector}>
                    <SelectTrigger data-testid="select-upload-brand-sector">
                      <SelectValue placeholder="Select sector" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {BRAND_SECTORS.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div>
              <Label>Tags (comma separated)</Label>
              <Input
                placeholder="e.g. exterior, modern, glass"
                value={uploadTags}
                onChange={(e) => setUploadTags(e.target.value)}
                data-testid="input-upload-tags"
              />
            </div>
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleUpload(e.dataTransfer.files);
              }}
              data-testid="dropzone-upload"
            >
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Click or drag images here</p>
              <p className="text-xs text-muted-foreground mt-1">Up to 20 images, max 25MB each</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handleUpload(e.target.files)}
                data-testid="input-file-upload"
              />
            </div>
            {uploadMutation.isPending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading...
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={streetViewDialogOpen} onOpenChange={setStreetViewDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" /> Google Street View Capture
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Property Address</Label>
              <Input
                placeholder="e.g. 10 Hanover Square, London W1S 1JB"
                value={streetViewAddress}
                onChange={(e) => setStreetViewAddress(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStreetViewPreview()}
                data-testid="input-streetview-address"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Heading (0-360°)</Label>
                <Input
                  type="number"
                  min={0}
                  max={360}
                  value={streetViewHeading}
                  onChange={(e) => setStreetViewHeading(Number(e.target.value))}
                  data-testid="input-streetview-heading"
                />
              </div>
              <div>
                <Label className="text-xs">Pitch (-90 to 90°)</Label>
                <Input
                  type="number"
                  min={-90}
                  max={90}
                  value={streetViewPitch}
                  onChange={(e) => setStreetViewPitch(Number(e.target.value))}
                  data-testid="input-streetview-pitch"
                />
              </div>
              <div>
                <Label className="text-xs">FOV (10-120°)</Label>
                <Input
                  type="number"
                  min={10}
                  max={120}
                  value={streetViewFov}
                  onChange={(e) => setStreetViewFov(Number(e.target.value))}
                  data-testid="input-streetview-fov"
                />
              </div>
            </div>
            <Button onClick={handleStreetViewPreview} className="w-full" data-testid="button-streetview-preview">
              <Camera className="h-4 w-4 mr-2" /> Preview Street View
            </Button>
            {streetViewPreviewUrl && (
              <div className="space-y-3">
                <div className="relative rounded-lg overflow-hidden border bg-muted">
                  <img
                    src={streetViewPreviewUrl}
                    alt="Street View Preview"
                    className="w-full h-auto"
                    data-testid="img-streetview-preview"
                  />
                </div>
                <Button
                  onClick={() => captureStreetViewMutation.mutate()}
                  className="w-full"
                  disabled={captureStreetViewMutation.isPending}
                  data-testid="button-streetview-capture"
                >
                  {captureStreetViewMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Save to Library
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={stockSearchOpen} onOpenChange={setStockSearchOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" /> Stock Photo Search
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search for stock photos..."
                value={stockQuery}
                onChange={(e) => setStockQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStockSearch()}
                className="flex-1"
                data-testid="input-stock-search"
              />
              <Button onClick={handleStockSearch} disabled={stockLoading} data-testid="button-stock-search-go">
                {stockLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            <ScrollArea className="h-[50vh]">
              {stockResults.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {stockResults.map((result: any) => (
                    <div key={result.id} className="group relative rounded-lg overflow-hidden border cursor-pointer">
                      <img
                        src={result.urls.small}
                        alt={result.description || "Stock photo"}
                        className="w-full aspect-[4/3] object-cover"
                      />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                        <p className="text-white text-xs px-2 text-center">{result.photographer}</p>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            importStockMutation.mutate({
                              imageUrl: result.urls.regular,
                              fileName: result.description || "Stock Image",
                              photographer: result.photographer,
                              category: "Stock",
                            })
                          }
                          data-testid={`button-import-stock-${result.id}`}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Import
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : !stockLoading ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Globe className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">Search for stock photos above</p>
                </div>
              ) : null}
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Image Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>File Name</Label>
              <Input
                value={editForm.fileName}
                onChange={(e) => setEditForm({ ...editForm, fileName: e.target.value })}
                data-testid="input-edit-filename"
              />
            </div>
            <div>
              <Label>Category</Label>
              <Select
                value={editForm.category}
                onValueChange={(v) => setEditForm({ ...editForm, category: v })}
              >
                <SelectTrigger data-testid="select-edit-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.filter((c) => c !== "All").map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Address</Label>
              <Input
                placeholder="e.g. 10 Finsbury Square, London EC2A 1AF"
                value={editForm.address}
                onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                data-testid="input-edit-address"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Area</Label>
                <Input
                  placeholder="e.g. Mayfair, City"
                  value={editForm.area}
                  onChange={(e) => setEditForm({ ...editForm, area: e.target.value })}
                  data-testid="input-edit-area"
                />
              </div>
              <div>
                <Label>Property Type</Label>
                <Select value={editForm.propertyType || "none"} onValueChange={(v) => setEditForm({ ...editForm, propertyType: v === "none" ? "" : v })}>
                  <SelectTrigger data-testid="select-edit-property-type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {PROPERTY_TYPES.map((pt) => (
                      <SelectItem key={pt} value={pt}>{pt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {editForm.category === "Brands" && (
              <>
                <div>
                  <Label>Brand Name</Label>
                  <Input
                    placeholder="e.g. Pret A Manger, WeWork, Zara"
                    value={editForm.brandName}
                    onChange={(e) => setEditForm({ ...editForm, brandName: e.target.value })}
                    data-testid="input-edit-brand-name"
                  />
                </div>
                <div>
                  <Label>Sector</Label>
                  <Select value={editForm.brandSector || "none"} onValueChange={(v) => setEditForm({ ...editForm, brandSector: v === "none" ? "" : v })}>
                    <SelectTrigger data-testid="select-edit-brand-sector">
                      <SelectValue placeholder="Select sector" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {BRAND_SECTORS.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div>
              <Label>Tags (comma separated)</Label>
              <Input
                value={editForm.tags}
                onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
                data-testid="input-edit-tags"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={3}
                data-testid="textarea-edit-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (!selectedImage) return;
                updateMutation.mutate({
                  id: selectedImage.id,
                  data: {
                    fileName: editForm.fileName,
                    category: editForm.category,
                    area: editForm.area,
                    address: editForm.address,
                    brandName: editForm.brandName,
                    brandSector: editForm.brandSector,
                    propertyType: editForm.propertyType,
                    tags: editForm.tags.split(",").map((t) => t.trim()).filter(Boolean),
                    description: editForm.description,
                  },
                });
              }}
              disabled={updateMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {lightboxOpen && selectedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxOpen(false)}
          data-testid="lightbox-overlay"
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white"
            onClick={() => setLightboxOpen(false)}
            data-testid="button-close-lightbox"
          >
            <X className="h-6 w-6" />
          </button>
          <div
            className="max-w-5xl max-h-[90vh] flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={`/api/image-studio/${selectedImage.id}/full`}
              alt={selectedImage.fileName}
              className="max-w-full max-h-[75vh] object-contain rounded"
              data-testid="img-lightbox-full"
            />
            <div className="text-white text-center space-y-1">
              <p className="font-medium">{selectedImage.fileName}</p>
              <div className="flex items-center gap-2 justify-center flex-wrap">
                <Badge variant="secondary">{selectedImage.category}</Badge>
                {selectedImage.area && <Badge variant="outline" className="text-white border-white/30">{selectedImage.area}</Badge>}
                {selectedImage.tags?.map((t) => (
                  <Badge key={t} variant="outline" className="text-white/70 border-white/20 text-xs">{t}</Badge>
                ))}
              </div>
              {(selectedImage as any).address && (
                <p className="text-xs text-white/60"><MapPin className="h-3 w-3 inline mr-1" />{(selectedImage as any).address}</p>
              )}
              {selectedImage.description && (
                <p className="text-sm text-white/70 max-w-lg">{selectedImage.description}</p>
              )}
              <div className="flex gap-2 justify-center mt-2">
                <Button size="sm" variant="secondary" onClick={() => openEdit(selectedImage)} data-testid="button-lightbox-edit">
                  <Edit className="h-3 w-3 mr-1" /> Edit
                </Button>
                <Button size="sm" variant="secondary" onClick={() => aiTagMutation.mutate(selectedImage.id)} data-testid="button-lightbox-ai-tag">
                  <Wand2 className="h-3 w-3 mr-1" /> AI Tag
                </Button>
                <Button size="sm" variant="secondary" onClick={() => {
                  setAiEditImageId(selectedImage.id);
                  setAiEditImageName(selectedImage.fileName || "");
                  setAiEditPrompt("");
                  setAiEditOpen(true);
                }} data-testid="button-lightbox-ai-edit">
                  <Sparkles className="h-3 w-3 mr-1" /> AI Touch Up
                </Button>
                <a
                  href={`/api/image-studio/${selectedImage.id}/full`}
                  download={selectedImage.fileName}
                  className="inline-flex"
                >
                  <Button size="sm" variant="secondary" data-testid="button-lightbox-download">
                    <Download className="h-3 w-3 mr-1" /> Download
                  </Button>
                </a>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    if (confirm("Delete this image?")) deleteMutation.mutate(selectedImage.id);
                  }}
                  data-testid="button-lightbox-delete"
                >
                  <Trash2 className="h-3 w-3 mr-1" /> Delete
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Dialog open={aiGenerateOpen} onOpenChange={setAiGenerateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" /> AI Image Generation
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Describe the image you want to create</Label>
              <Textarea
                placeholder="e.g. Modern glass office building in Mayfair with city skyline backdrop, professional architectural photography"
                value={aiGeneratePrompt}
                onChange={(e) => setAiGeneratePrompt(e.target.value)}
                rows={3}
                data-testid="input-ai-generate-prompt"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <Select value={aiGenerateCategory} onValueChange={setAiGenerateCategory}>
                  <SelectTrigger data-testid="select-ai-generate-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Generated", "Exteriors", "Interiors", "Floor Plans", "Properties", "Areas", "Marketing", "Other"].map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Area (optional)</Label>
                <Input
                  placeholder="e.g. City of London"
                  value={aiGenerateArea}
                  onChange={(e) => setAiGenerateArea(e.target.value)}
                  data-testid="input-ai-generate-area"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              AI will generate a professional property image based on your description. This may take up to 30 seconds.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiGenerateOpen(false)} data-testid="button-ai-generate-cancel">Cancel</Button>
            <Button
              onClick={() => aiGenerateMutation.mutate({
                prompt: aiGeneratePrompt,
                category: aiGenerateCategory,
                area: aiGenerateArea || undefined,
              })}
              disabled={!aiGeneratePrompt.trim() || aiGenerateMutation.isPending}
              data-testid="button-ai-generate-submit"
            >
              {aiGenerateMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Generating...</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-1" /> Generate Image</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={aiEditOpen} onOpenChange={setAiEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" /> AI Touch Up
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {aiEditImageName && (
              <p className="text-sm text-muted-foreground">
                Editing: <span className="font-medium text-foreground">{aiEditImageName}</span>
              </p>
            )}
            <div>
              <Label>What changes would you like?</Label>
              <Textarea
                placeholder="e.g. Make the sky blue and sunny, brighten the interior, remove the scaffolding, enhance the building facade"
                value={aiEditPrompt}
                onChange={(e) => setAiEditPrompt(e.target.value)}
                rows={3}
                data-testid="input-ai-edit-prompt"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              AI will create a new edited version of the image. The original will remain unchanged.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiEditOpen(false)} data-testid="button-ai-edit-cancel">Cancel</Button>
            <Button
              onClick={() => {
                if (aiEditImageId) {
                  aiEditMutation.mutate({ imageId: aiEditImageId, editPrompt: aiEditPrompt });
                }
              }}
              disabled={!aiEditPrompt.trim() || aiEditMutation.isPending}
              data-testid="button-ai-edit-submit"
            >
              {aiEditMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Processing...</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-1" /> Apply Touch Up</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}

function ImageCard({
  image,
  onView,
  onEdit,
  onAiTag,
  onAiEdit,
  onDelete,
  aiTagging,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  image: ImageStudioImage;
  onView: () => void;
  onEdit: () => void;
  onAiTag: () => void;
  onAiEdit: () => void;
  onDelete: () => void;
  aiTagging: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  return (
    <div
      className={`group relative rounded-lg overflow-hidden border bg-card cursor-pointer transition-all ${selected ? "ring-2 ring-primary" : "hover:ring-2 hover:ring-primary/50"}`}
      data-testid={`card-image-${image.id}`}
      onClick={selectMode ? onToggleSelect : undefined}
    >
      {selectMode && (
        <div className={`absolute top-2 left-2 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${selected ? "bg-primary border-primary" : "bg-white/80 border-gray-400"}`}>
          {selected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
        </div>
      )}
      <div className="aspect-square" onClick={selectMode ? undefined : onView}>
        {image.thumbnailData ? (
          <img
            src={image.thumbnailData}
            alt={image.fileName}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted">
            <ImageIconLucide className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="text-white text-xs font-medium truncate">{(image as any).brandName || image.fileName}</p>
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          <Badge variant="secondary" className="text-[10px] h-4 px-1">{image.category}</Badge>
          {image.area && <Badge variant="outline" className="text-[10px] h-4 px-1 text-white border-white/30">{image.area}</Badge>}
          {(image as any).address && <Badge variant="outline" className="text-[10px] h-4 px-1 text-white/70 border-white/20 truncate max-w-[120px]">{(image as any).address}</Badge>}
        </div>
      </div>
      <div className="absolute top-1 left-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex justify-end gap-0.5 flex-wrap">
        <Button size="icon" variant="secondary" className="h-5 w-5 rounded-sm" onClick={(e) => { e.stopPropagation(); onView(); }} data-testid={`button-view-${image.id}`}>
          <Eye className="h-2.5 w-2.5" />
        </Button>
        <Button size="icon" variant="secondary" className="h-5 w-5 rounded-sm" onClick={(e) => { e.stopPropagation(); onEdit(); }} data-testid={`button-edit-${image.id}`}>
          <Edit className="h-2.5 w-2.5" />
        </Button>
        <Button size="icon" variant="secondary" className="h-5 w-5 rounded-sm" onClick={(e) => { e.stopPropagation(); onAiTag(); }} data-testid={`button-ai-tag-${image.id}`}>
          <Wand2 className="h-2.5 w-2.5" />
        </Button>
        <Button size="icon" variant="secondary" className="h-5 w-5 rounded-sm" onClick={(e) => { e.stopPropagation(); onAiEdit(); }} data-testid={`button-ai-edit-${image.id}`}>
          <Sparkles className="h-2.5 w-2.5" />
        </Button>
        <Button size="icon" variant="destructive" className="h-5 w-5 rounded-sm" onClick={(e) => { e.stopPropagation(); onDelete(); }} data-testid={`button-delete-${image.id}`}>
          <Trash2 className="h-2.5 w-2.5" />
        </Button>
      </div>
    </div>
  );
}

function ImageListRow({
  image,
  onView,
  onEdit,
  onAiTag,
  onAiEdit,
  onDelete,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  image: ImageStudioImage;
  onView: () => void;
  onEdit: () => void;
  onAiTag: () => void;
  onAiEdit: () => void;
  onDelete: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${selected ? "bg-primary/10 border-primary" : "hover:bg-muted/50"}`}
      onClick={selectMode ? onToggleSelect : onView}
      data-testid={`row-image-${image.id}`}
    >
      {selectMode && (
        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${selected ? "bg-primary border-primary" : "border-gray-400"}`}>
          {selected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
        </div>
      )}
      <div className="h-12 w-12 rounded overflow-hidden flex-shrink-0">
        {image.thumbnailData ? (
          <img src={image.thumbnailData} alt={image.fileName} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-muted flex items-center justify-center">
            <ImageIconLucide className="h-4 w-4 text-muted-foreground/30" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{(image as any).brandName || image.fileName}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <Badge variant="secondary" className="text-[10px] h-4 px-1">{image.category}</Badge>
          {image.area && <Badge variant="outline" className="text-[10px] h-4 px-1">{image.area}</Badge>}
          {(image as any).address && <Badge variant="outline" className="text-[10px] h-4 px-1 truncate max-w-[150px]">{(image as any).address}</Badge>}
          {image.source && image.source !== "upload" && (
            <Badge variant="outline" className="text-[10px] h-4 px-1">{image.source}</Badge>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 text-xs text-muted-foreground">
        {image.width && image.height ? `${image.width}×${image.height}` : ""}
        {image.fileSize ? ` · ${(image.fileSize / 1024).toFixed(0)}KB` : ""}
      </div>
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit} data-testid={`button-edit-list-${image.id}`}>
          <Edit className="h-3 w-3" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onAiTag} data-testid={`button-ai-tag-list-${image.id}`}>
          <Wand2 className="h-3 w-3" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onAiEdit} data-testid={`button-ai-edit-list-${image.id}`}>
          <Sparkles className="h-3 w-3" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete} data-testid={`button-delete-list-${image.id}`}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

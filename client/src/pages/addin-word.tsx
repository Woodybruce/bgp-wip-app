import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getQueryFn, apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, ChevronRight, ExternalLink, Copy,
  CheckCircle2, AlertCircle, Sparkles
} from "lucide-react";
import { AddinHeader } from "@/components/addin-header";

function AddinWord() {
  const { toast } = useToast();
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery<any[]>({
    queryKey: ["/api/document-templates"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const generateMutation = useMutation({
    mutationFn: async (data: { templateId: string; fieldValues: Record<string, string> }) => {
      const res = await apiRequest("POST", `/api/document-templates/${data.templateId}/generate`, {
        fieldValues: data.fieldValues,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setGeneratedContent(data.content);
      toast({ title: "Document generated", description: "Content ready to insert" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleGenerate = () => {
    if (!selectedTemplate) return;
    generateMutation.mutate({
      templateId: selectedTemplate.id,
      fieldValues,
    });
  };

  const handleCopyToClipboard = () => {
    if (generatedContent) {
      navigator.clipboard.writeText(generatedContent);
      toast({ title: "Copied", description: "Content copied to clipboard" });
    }
  };

  const handleInsertIntoWord = () => {
    if (generatedContent && window.Office) {
      try {
        window.Office.context.document.setSelectedDataAsync(
          generatedContent,
          { coercionType: window.Office.CoercionType.Text },
          (result: any) => {
            if (result.status === "succeeded") {
              toast({ title: "Inserted", description: "Content added to document" });
            } else {
              toast({ title: "Error", description: "Could not insert into document", variant: "destructive" });
            }
          }
        );
      } catch {
        handleCopyToClipboard();
      }
    } else {
      handleCopyToClipboard();
    }
  };

  if (generatedContent) {
    return (
      <div className="min-h-screen bg-background text-foreground" style={{ maxWidth: 400 }}>
        <AddinHeader title="Generated Document" subtitle="Word" />
        <div className="p-3 space-y-3">
          <div className="flex gap-2">
            <Button
              data-testid="button-insert"
              size="sm"
              className="flex-1 h-8 text-xs"
              onClick={handleInsertIntoWord}
            >
              <FileText className="h-3 w-3 mr-1" /> Insert into Document
            </Button>
            <Button
              data-testid="button-copy"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={handleCopyToClipboard}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>

          <ScrollArea className="h-[calc(100vh-160px)]">
            <div className="bg-muted rounded-md p-3">
              <pre className="text-xs whitespace-pre-wrap font-sans">{generatedContent}</pre>
            </div>
          </ScrollArea>

          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs h-7"
            onClick={() => { setGeneratedContent(null); setFieldValues({}); setSelectedTemplate(null); }}
            data-testid="button-new"
          >
            Generate another document
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ maxWidth: 400 }}>
      <AddinHeader title="BGP Document Studio" subtitle="Word" />
      <div className="p-3">

      {selectedTemplate ? (
        <div className="space-y-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSelectedTemplate(null); setFieldValues({}); }}
            className="text-xs h-7 px-2"
            data-testid="button-back"
          >
            ← Back to templates
          </Button>

          <Card>
            <CardHeader className="p-3 pb-1">
              <CardTitle className="text-sm">{selectedTemplate.name}</CardTitle>
              {selectedTemplate.description && (
                <p className="text-xs text-muted-foreground">{selectedTemplate.description}</p>
              )}
            </CardHeader>
            <CardContent className="p-3 pt-2">
              <ScrollArea className="max-h-[calc(100vh-260px)]">
                <div className="space-y-3">
                  {((() => { try { return JSON.parse(selectedTemplate.fields || "[]"); } catch { return []; } })()).map((field: any) => (
                    <div key={field.id}>
                      <Label className="text-xs">{field.label || field.id}</Label>
                      {field.type === "textarea" ? (
                        <Textarea
                          data-testid={`input-field-${field.id}`}
                          className="text-xs mt-1 min-h-[60px]"
                          placeholder={field.placeholder || ""}
                          value={fieldValues[field.id] || ""}
                          onChange={(e) => setFieldValues({ ...fieldValues, [field.id]: e.target.value })}
                        />
                      ) : (
                        <Input
                          data-testid={`input-field-${field.id}`}
                          className="h-7 text-xs mt-1"
                          placeholder={field.placeholder || ""}
                          value={fieldValues[field.id] || ""}
                          onChange={(e) => setFieldValues({ ...fieldValues, [field.id]: e.target.value })}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>

              <Button
                data-testid="button-generate"
                className="w-full h-8 text-xs mt-3"
                onClick={handleGenerate}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending ? (
                  <>Generating...</>
                ) : (
                  <><Sparkles className="h-3 w-3 mr-1" /> Generate Document</>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <ScrollArea className="h-[calc(100vh-100px)]">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : templates && templates.length > 0 ? (
            <div className="space-y-1.5">
              {templates.filter((t: any) => t.status === "ready").map((t: any) => {
                let fields: any[] = [];
                try { fields = JSON.parse(t.fields || "[]"); } catch {}
                return (
                  <Card
                    key={t.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setSelectedTemplate(t)}
                    data-testid={`card-template-${t.id}`}
                  >
                    <CardContent className="p-2.5">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{t.name}</p>
                          {t.description && (
                            <p className="text-xs text-muted-foreground truncate">{t.description}</p>
                          )}
                          <Badge variant="secondary" className="text-[10px] mt-1">
                            {fields.length} fields
                          </Badge>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8">
              <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No document templates</p>
              <p className="text-xs text-muted-foreground mt-1">Create templates in the BGP Dashboard</p>
            </div>
          )}
        </ScrollArea>
      )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-2 bg-background border-t" style={{ maxWidth: 400 }}>
        <a
          href="https://chatbgp.app/templates"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          data-testid="link-open-templates"
        >
          Open full templates page <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

export default AddinWord;

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, ExternalLink, Mail, FileSpreadsheet, FileText, Presentation, Users, Palette } from "lucide-react";

const addins = [
  {
    name: "Outlook",
    icon: Mail,
    description: "CRM sidebar that automatically looks up email senders — see contacts, companies, and deals without leaving Outlook.",
    manifest: "/manifests/outlook-addin.xml",
    preview: "/addin/outlook",
    adminSteps: "Microsoft 365 Admin Centre → Settings → Integrated Apps → Upload custom apps",
    color: "bg-blue-50 dark:bg-blue-950",
  },
  {
    name: "Excel",
    icon: FileSpreadsheet,
    description: "ChatBGP AI assistant for Excel — write formulas, build financial models, look up CRM data, and get help with any spreadsheet task. Powered by BGP's AI with full access to your deals, properties, and contacts.",
    manifest: "/manifests/excel-addin.xml",
    preview: "/addin/excel",
    adminSteps: "Microsoft 365 Admin Centre → Settings → Integrated Apps → Upload custom apps",
    color: "bg-green-50 dark:bg-green-950",
  },
  {
    name: "Word",
    icon: FileText,
    description: "Generate documents from BGP templates and insert content directly into your Word document.",
    manifest: "/manifests/word-addin.xml",
    preview: "/addin/word",
    adminSteps: "Microsoft 365 Admin Centre → Settings → Integrated Apps → Upload custom apps",
    color: "bg-blue-50 dark:bg-blue-950",
  },
  {
    name: "PowerPoint",
    icon: Presentation,
    description: "Search CRM data, comps, and available units to insert into your presentations.",
    manifest: "/manifests/powerpoint-addin.xml",
    preview: "/addin/powerpoint",
    adminSteps: "Microsoft 365 Admin Centre → Settings → Integrated Apps → Upload custom apps",
    color: "bg-orange-50 dark:bg-orange-950",
  },
  {
    name: "Teams",
    icon: Users,
    description: "Dashboard overview, active deals, and news as a Teams personal app or channel tab.",
    manifest: "/manifests/teams-manifest.json",
    preview: "/addin/teams",
    adminSteps: "Teams Admin Centre → Teams apps → Manage apps → Upload new app (zip the JSON file first)",
    color: "bg-purple-50 dark:bg-purple-950",
  },
  {
    name: "Adobe Creative Cloud",
    icon: Palette,
    description: "Search CRM data, properties, and news content for use in InDesign, Illustrator, and Photoshop designs.",
    manifest: null,
    preview: "/addin/adobe",
    adminSteps: "Open in a browser window alongside your Adobe app, or bookmark it for quick access.",
    color: "bg-red-50 dark:bg-red-950",
  },
];

function AddinsPage() {
  const handleDownload = (url: string, filename: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Office & Creative Add-ins</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Install BGP Dashboard as an add-in inside Microsoft Office and Adobe apps.
          Download the manifest files below and upload them to your Microsoft 365 Admin Centre.
        </p>
      </div>

      <Card className="mb-6 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-2">How to install (for admins)</h3>
          <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
            <li>Download the manifest file for the add-in you want</li>
            <li>Go to <a href="https://admin.microsoft.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline">admin.microsoft.com</a></li>
            <li>Navigate to <strong>Settings → Integrated Apps → Upload custom apps</strong></li>
            <li>Choose <strong>"Upload manifest file"</strong> and select the downloaded XML file</li>
            <li>Deploy to your entire organisation or specific users</li>
            <li>The add-in will appear in the Office ribbon within a few hours</li>
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {addins.map((addin) => (
          <Card key={addin.name} className="overflow-hidden" data-testid={`card-addin-${addin.name.toLowerCase()}`}>
            <CardHeader className={`p-4 pb-3 ${addin.color}`}>
              <div className="flex items-center gap-2">
                <addin.icon className="h-5 w-5" />
                <CardTitle className="text-base">{addin.name}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-3">
              <p className="text-xs text-muted-foreground mb-3">{addin.description}</p>
              <p className="text-[10px] text-muted-foreground mb-3 italic">{addin.adminSteps}</p>
              <div className="flex gap-2">
                {addin.manifest && (
                  <Button
                    size="sm"
                    className="h-7 text-xs flex-1"
                    onClick={() => handleDownload(addin.manifest!, `bgp-${addin.name.toLowerCase()}-addin${addin.manifest!.endsWith('.json') ? '.json' : '.xml'}`)}
                    data-testid={`button-download-${addin.name.toLowerCase()}`}
                  >
                    <Download className="h-3 w-3 mr-1" /> Download Manifest
                  </Button>
                )}
                <a href={addin.preview} target="_blank" rel="noopener noreferrer">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    data-testid={`button-preview-${addin.name.toLowerCase()}`}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" /> Preview
                  </Button>
                </a>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default AddinsPage;

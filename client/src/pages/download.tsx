import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Download, RotateCcw, FileArchive, FileText } from "lucide-react";
import { useLocation } from "wouter";
import type { ApplyResponse } from "@shared/schema";

export default function DownloadPage() {
  const [, setLocation] = useLocation();
  const [downloadData, setDownloadData] = useState<ApplyResponse | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("docx_download");
    if (!stored) {
      setLocation("/");
      return;
    }
    setDownloadData(JSON.parse(stored));
  }, [setLocation]);

  const handleDownloadFinal = () => {
    if (!downloadData) return;
    window.open(downloadData.downloadUrl, "_blank");
  };

  const handleDownloadPdf = () => {
    if (!downloadData?.pdfDownloadUrl) return;
    window.open(downloadData.pdfDownloadUrl, "_blank");
  };

  const handleDownloadMaster = () => {
    if (!downloadData) return;
    window.open(downloadData.masterDownloadUrl, "_blank");
  };

  const handleStartOver = () => {
    sessionStorage.removeItem("docx_session");
    sessionStorage.removeItem("docx_preview");
    sessionStorage.removeItem("docx_replacements");
    sessionStorage.removeItem("docx_download");
    setLocation("/");
  };

  if (!downloadData) return null;

  const hasFinalVersion = downloadData.downloadUrl !== downloadData.masterDownloadUrl;
  const hasPdf = !!downloadData.pdfDownloadUrl;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 mb-4">
            <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-download-title">
            Changes Applied
          </h1>
          <p className="text-muted-foreground mt-2 text-base">
            Your resume has been updated successfully.
          </p>
        </div>

        <Card>
          <CardContent className="p-6 space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Updated Blocks
              </h3>
              <div className="flex flex-wrap gap-2">
                {downloadData.updatedBlocks.map((name) => (
                  <Badge key={name} variant="secondary" className="font-mono text-xs" data-testid={`badge-updated-${name}`}>
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    {name}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Log
              </h3>
              <div className="p-3 rounded-md bg-muted/50 max-h-40 overflow-y-auto">
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed" data-testid="text-log">
                  {downloadData.log}
                </pre>
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-2">
              {hasFinalVersion ? (
                <>
                  {hasPdf && (
                    <Button onClick={handleDownloadPdf} className="w-full" data-testid="button-download-pdf">
                      <FileText className="w-4 h-4 mr-2" />
                      Download PDF (submit-ready)
                    </Button>
                  )}
                  <Button variant={hasPdf ? "outline" : "default"} onClick={handleDownloadFinal} className="w-full" data-testid="button-download-final">
                    <Download className="w-4 h-4 mr-2" />
                    Download FINAL DOCX
                  </Button>
                  <Button variant="outline" onClick={handleDownloadMaster} className="w-full" data-testid="button-download-master">
                    <FileArchive className="w-4 h-4 mr-2" />
                    Download MASTER (editable, with markers)
                  </Button>
                </>
              ) : (
                <Button onClick={handleDownloadFinal} className="w-full" data-testid="button-download-docx">
                  <Download className="w-4 h-4 mr-2" />
                  Download DOCX
                </Button>
              )}
              <Button variant="outline" onClick={handleStartOver} className="w-full" data-testid="button-start-over">
                <RotateCcw className="w-4 h-4 mr-2" />
                Edit Another Resume
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

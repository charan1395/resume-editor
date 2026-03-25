import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Download, FileText, CheckCircle2 } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import type { PreviewResponse, ApplyResponse } from "@shared/schema";

export default function PreviewPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [removeMarkers, setRemoveMarkers] = useState(true);

  useEffect(() => {
    const stored = sessionStorage.getItem("docx_preview");
    if (!stored) {
      setLocation("/edit");
      return;
    }
    setPreviewData(JSON.parse(stored));
  }, [setLocation]);

  const handleApply = useCallback(async () => {
    if (!previewData) return;
    const replacementsStr = sessionStorage.getItem("docx_replacements");
    if (!replacementsStr) return;

    setIsApplying(true);
    try {
      const stripBulletsStr = sessionStorage.getItem("docx_stripBulletsBlocks");
      const stripBulletsBlocks = stripBulletsStr ? JSON.parse(stripBulletsStr) : [];

      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: previewData.sessionId,
          replacements: JSON.parse(replacementsStr),
          removeMarkers,
          stripBulletsBlocks,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Apply failed");
      }

      const data: ApplyResponse = await res.json();
      sessionStorage.setItem("docx_download", JSON.stringify(data));
      setLocation("/download");
    } catch (err: any) {
      toast({
        title: "Failed to apply changes",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsApplying(false);
    }
  }, [previewData, removeMarkers, setLocation, toast]);

  if (!previewData) return null;

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-preview-title">
              Preview Changes
            </h1>
            <p className="text-sm text-muted-foreground">
              Review text changes before applying
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <Badge variant="secondary" data-testid="badge-diff-count">
            {previewData.diffs.length} block{previewData.diffs.length !== 1 ? "s" : ""} modified
          </Badge>
        </div>

        <div className="space-y-4">
          {previewData.diffs.map((diff) => (
            <Card key={diff.blockName} data-testid={`card-diff-${diff.blockName}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-sm font-mono" data-testid={`text-diff-block-${diff.blockName}`}>
                    {diff.blockName}
                  </h3>
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      Before
                    </label>
                    <div className="p-3 rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 max-h-48 overflow-y-auto">
                      <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed text-red-900 dark:text-red-200" data-testid={`text-before-${diff.blockName}`}>
                        {diff.before || "(empty)"}
                      </pre>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      After
                    </label>
                    <div className="p-3 rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 max-h-48 overflow-y-auto">
                      <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed text-green-900 dark:text-green-200" data-testid={`text-after-${diff.blockName}`}>
                        {diff.after || "(empty)"}
                      </pre>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Diff
                  </label>
                  <div
                    className="p-3 rounded-md bg-muted/50 max-h-48 overflow-y-auto text-xs font-mono leading-relaxed diff-container"
                    data-testid={`diff-html-${diff.blockName}`}
                    dangerouslySetInnerHTML={{ __html: diff.diffHtml }}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mt-4">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="remove-markers"
                data-testid="checkbox-remove-markers"
                checked={removeMarkers}
                onCheckedChange={(checked) => setRemoveMarkers(checked === true)}
              />
              <div>
                <label htmlFor="remove-markers" className="text-sm font-medium cursor-pointer leading-none">
                  Generate submit-ready file (remove markers)
                </label>
                <p className="text-xs text-muted-foreground mt-1">
                  When checked, the default download will have all [[BLOCK:...]] and [[END:...]] markers removed, ready for job applications. A master copy with markers is always available.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-between gap-3 mt-6 flex-wrap">
          <Button variant="outline" onClick={() => setLocation("/edit")} data-testid="button-back-edit">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Edit
          </Button>
          <Button onClick={handleApply} disabled={isApplying} data-testid="button-apply-download">
            {isApplying ? (
              <>Applying...</>
            ) : (
              <>
                <Download className="w-4 h-4 mr-1" />
                Apply & Download
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

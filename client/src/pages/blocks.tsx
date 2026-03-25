import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, ArrowRight, FileText, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import type { UploadResponse, BlockInfo } from "@shared/schema";

const EXPECTED_BLOCKS = [
  "TECHNICAL_SKILLS",
  "WELLS_FARGO_POINTS",
  "MAX_HEALTHCARE_POINTS",
  "SBI_LIFE_POINTS",
];

export default function BlocksPage() {
  const [, setLocation] = useLocation();
  const [sessionData, setSessionData] = useState<UploadResponse | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("docx_session");
    if (!stored) {
      setLocation("/");
      return;
    }
    setSessionData(JSON.parse(stored));
  }, [setLocation]);

  if (!sessionData) return null;

  const foundNames = sessionData.blocks.map((b) => b.name);
  const missingExpected = EXPECTED_BLOCKS.filter((n) => !foundNames.includes(n));

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-blocks-title">
              Detected Blocks
            </h1>
            <p className="text-sm text-muted-foreground truncate" data-testid="text-filename">
              {sessionData.fileName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <Badge variant="secondary" data-testid="badge-block-count">
            {sessionData.blocks.length} block{sessionData.blocks.length !== 1 ? "s" : ""} found
          </Badge>
          {missingExpected.length > 0 && (
            <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-600">
              {missingExpected.length} expected missing
            </Badge>
          )}
        </div>

        {sessionData.blocks.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
              <h2 className="text-lg font-semibold mb-1">No Blocks Found</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Your DOCX doesn't contain any block markers. Add markers like
                [[BLOCK:NAME]] and [[END:NAME]] to your document.
              </p>
              <Button onClick={() => setLocation("/")} data-testid="button-reupload">
                Upload Another File
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="space-y-3">
              {sessionData.blocks.map((block: BlockInfo) => (
                <Card key={block.name} data-testid={`card-block-${block.name}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-start gap-3 min-w-0">
                        <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <h3 className="font-semibold text-sm font-mono" data-testid={`text-block-name-${block.name}`}>
                            {block.name}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1">
                            {block.paragraphCount} paragraph{block.paragraphCount !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                      <Badge variant="secondary" className="flex-shrink-0">
                        Editable
                      </Badge>
                    </div>
                    {block.currentText && (
                      <div className="mt-3 p-3 rounded-md bg-muted/50 max-h-32 overflow-y-auto">
                        <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed" data-testid={`text-block-content-${block.name}`}>
                          {block.currentText}
                        </pre>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            {missingExpected.length > 0 && (
              <div className="mt-4 p-3 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                <div className="flex gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      Missing expected blocks
                    </p>
                    <div className="flex gap-1 flex-wrap mt-1">
                      {missingExpected.map((name) => (
                        <Badge key={name} variant="outline" className="text-xs font-mono">
                          {name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-between gap-3 mt-6 flex-wrap">
              <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-back-upload">
                Upload Different File
              </Button>
              <Button onClick={() => setLocation("/edit")} data-testid="button-proceed-edit">
                Edit Blocks
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

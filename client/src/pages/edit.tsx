import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowRight, ArrowLeft, FileText, Pencil, Terminal, AlertCircle, Eye } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import type { UploadResponse, PreviewResponse } from "@shared/schema";

export default function EditPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [sessionData, setSessionData] = useState<UploadResponse | null>(null);
  const [mode, setMode] = useState<"structured" | "instruction">("structured");
  const [structuredEdits, setStructuredEdits] = useState<Record<string, string>>({});
  const [stripBulletsBlocks, setStripBulletsBlocks] = useState<Record<string, boolean>>({});
  const [instructionText, setInstructionText] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem("docx_session");
    if (!stored) {
      setLocation("/");
      return;
    }
    setSessionData(JSON.parse(stored));
  }, [setLocation]);

  const buildReplacements = useCallback((): Record<string, string> | null => {
    if (mode === "structured") {
      const edits: Record<string, string> = {};
      for (const [name, text] of Object.entries(structuredEdits)) {
        if (text.trim()) {
          edits[name] = text;
        }
      }
      const hasStripBullets = Object.values(stripBulletsBlocks).some(v => v);
      if (hasStripBullets && sessionData) {
        for (const block of sessionData.blocks) {
          if (stripBulletsBlocks[block.name] && !edits[block.name]) {
            edits[block.name] = block.currentText;
          }
        }
      }
      if (Object.keys(edits).length === 0) {
        toast({
          title: "No changes provided",
          description: "Enter replacement text for at least one block.",
          variant: "destructive",
        });
        return null;
      }
      return edits;
    } else {
      if (!instructionText.trim()) {
        toast({
          title: "No instructions provided",
          description: "Enter your replacement instructions.",
          variant: "destructive",
        });
        return null;
      }
      return { __instruction__: instructionText };
    }
  }, [mode, structuredEdits, stripBulletsBlocks, sessionData, instructionText, toast]);

  const getStripBulletsList = useCallback((): string[] => {
    return Object.entries(stripBulletsBlocks)
      .filter(([, v]) => v)
      .map(([k]) => k);
  }, [stripBulletsBlocks]);

  const handlePreview = useCallback(async () => {
    if (!sessionData) return;
    const replacements = buildReplacements();
    if (!replacements) return;

    const stripList = getStripBulletsList();
    sessionStorage.setItem("docx_stripBulletsBlocks", JSON.stringify(stripList));

    setIsLoading(true);
    try {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionData.sessionId,
          replacements,
          stripBulletsBlocks: stripList,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Preview generation failed");
      }

      const data: PreviewResponse = await res.json();
      sessionStorage.setItem("docx_preview", JSON.stringify(data));
      sessionStorage.setItem("docx_replacements", JSON.stringify(replacements));
      setLocation("/preview");
    } catch (err: any) {
      toast({
        title: "Preview failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [sessionData, buildReplacements, setLocation, toast]);

  if (!sessionData) return null;

  const exampleInstruction = sessionData.blocks.length > 0
    ? `Update ${sessionData.blocks[0].name} with:\nLine one of replacement text\nLine two of replacement text\nLine three`
    : "Update BLOCK_NAME with:\nLine one\nLine two";

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Pencil className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-edit-title">
              Edit Blocks
            </h1>
            <p className="text-sm text-muted-foreground truncate">
              {sessionData.fileName}
            </p>
          </div>
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="w-full">
          <TabsList className="w-full grid grid-cols-2 mb-4">
            <TabsTrigger value="structured" className="gap-1.5" data-testid="tab-structured">
              <FileText className="w-4 h-4" />
              Structured
            </TabsTrigger>
            <TabsTrigger value="instruction" className="gap-1.5" data-testid="tab-instruction">
              <Terminal className="w-4 h-4" />
              Instructions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="structured" className="space-y-4">
            {sessionData.blocks.map((block) => (
              <Card key={block.name} data-testid={`card-edit-${block.name}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="font-semibold text-sm font-mono" data-testid={`text-edit-block-name-${block.name}`}>
                      {block.name}
                    </h3>
                    <Badge variant="secondary" className="text-xs">
                      {block.paragraphCount} lines
                    </Badge>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      Current content
                    </label>
                    <div className="p-3 rounded-md bg-muted/50 max-h-28 overflow-y-auto">
                      <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed" data-testid={`text-current-${block.name}`}>
                        {block.currentText || "(empty)"}
                      </pre>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      Replacement text (one line per paragraph)
                    </label>
                    <Textarea
                      data-testid={`textarea-edit-${block.name}`}
                      placeholder={`Enter new content for ${block.name}...\nEach line becomes a separate paragraph\nUse **text** for bold`}
                      className="min-h-[120px] font-mono text-sm"
                      value={structuredEdits[block.name] || ""}
                      onChange={(e) =>
                        setStructuredEdits((prev) => ({
                          ...prev,
                          [block.name]: e.target.value,
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Wrap text in <code className="bg-muted px-1 py-0.5 rounded font-mono">**double asterisks**</code> to make it <strong>bold</strong>
                    </p>
                  </div>
                  {block.hasBullets && (
                    <div className="flex items-center gap-2 pt-1">
                      <Checkbox
                        id={`strip-bullets-${block.name}`}
                        data-testid={`checkbox-strip-bullets-${block.name}`}
                        checked={stripBulletsBlocks[block.name] || false}
                        onCheckedChange={(checked) =>
                          setStripBulletsBlocks((prev) => ({
                            ...prev,
                            [block.name]: checked === true,
                          }))
                        }
                      />
                      <label htmlFor={`strip-bullets-${block.name}`} className="text-xs text-muted-foreground cursor-pointer">
                        Remove bullet points from this block
                      </label>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="instruction">
            <Card>
              <CardContent className="p-4 space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Paste your instructions
                  </label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Use the format: <code className="bg-muted px-1 py-0.5 rounded font-mono">Update BLOCK_NAME with:</code> or{" "}
                    <code className="bg-muted px-1 py-0.5 rounded font-mono">Replace BLOCK_NAME with:</code> followed by content lines.
                  </p>
                  <Textarea
                    data-testid="textarea-instructions"
                    placeholder={exampleInstruction}
                    className="min-h-[300px] font-mono text-sm"
                    value={instructionText}
                    onChange={(e) => setInstructionText(e.target.value)}
                  />
                </div>

                <div className="p-3 rounded-md bg-muted/50">
                  <div className="flex gap-2">
                    <AlertCircle className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p className="font-medium">Instruction format</p>
                      <pre className="font-mono whitespace-pre-wrap leading-relaxed">{exampleInstruction}</pre>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1">
                  <span className="text-xs text-muted-foreground">Available blocks:</span>
                  {sessionData.blocks.map((b) => (
                    <Badge key={b.name} variant="outline" className="text-xs font-mono">
                      {b.name}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-between gap-3 mt-6 flex-wrap">
          <Button variant="outline" onClick={() => setLocation("/blocks")} data-testid="button-back-blocks">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <Button onClick={handlePreview} disabled={isLoading} data-testid="button-preview">
            {isLoading ? (
              <>Generating Preview...</>
            ) : (
              <>
                <Eye className="w-4 h-4 mr-1" />
                Preview Changes
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

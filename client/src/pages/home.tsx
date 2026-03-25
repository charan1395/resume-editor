import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, AlertCircle, CheckCircle2 } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import type { UploadResponse } from "@shared/schema";

export default function Home() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".docx")) {
      toast({
        title: "Invalid file type",
        description: "Please upload a .docx file only.",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Maximum file size is 10 MB.",
        variant: "destructive",
      });
      return;
    }

    setFileName(file.name);
    setIsUploading(true);
    setUploadProgress(20);

    const formData = new FormData();
    formData.append("file", file);

    try {
      setUploadProgress(50);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      setUploadProgress(80);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }

      const data: UploadResponse = await res.json();
      setUploadProgress(100);

      sessionStorage.setItem("docx_session", JSON.stringify(data));

      setTimeout(() => {
        setLocation("/blocks");
      }, 400);
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: err.message || "Something went wrong.",
        variant: "destructive",
      });
      setIsUploading(false);
      setUploadProgress(0);
      setFileName(null);
    }
  }, [setLocation, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <FileText className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-app-title">
            Resume DOCX Editor
          </h1>
          <p className="text-muted-foreground mt-2 text-base">
            Edit resume text while preserving all formatting perfectly.
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
            <div
              data-testid="dropzone-upload"
              className={`relative border-2 border-dashed rounded-md p-10 text-center cursor-pointer transition-colors ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              } ${isUploading ? "pointer-events-none opacity-60" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => {
                if (!isUploading) {
                  document.getElementById("file-input")?.click();
                }
              }}
            >
              <input
                id="file-input"
                data-testid="input-file"
                type="file"
                accept=".docx"
                className="hidden"
                onChange={handleFileInput}
              />

              {!isUploading ? (
                <>
                  <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-base font-medium">
                    Drop your .docx resume here
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    or click to browse
                  </p>
                  <Badge variant="secondary" className="mt-4">
                    Max 10 MB
                  </Badge>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-center gap-2 mb-3">
                    {uploadProgress < 100 ? (
                      <FileText className="w-6 h-6 text-primary animate-pulse" />
                    ) : (
                      <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
                    )}
                    <span className="text-sm font-medium truncate max-w-[200px]" data-testid="text-uploading-file">
                      {fileName}
                    </span>
                  </div>
                  <Progress value={uploadProgress} className="h-2 max-w-xs mx-auto" data-testid="progress-upload" />
                  <p className="text-sm text-muted-foreground mt-2">
                    {uploadProgress < 100 ? "Uploading and parsing..." : "Done! Redirecting..."}
                  </p>
                </>
              )}
            </div>

            <div className="mt-6 space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                How it works
              </h3>
              <div className="grid gap-3">
                {[
                  { step: "1", text: "Add block markers to your DOCX resume" },
                  { step: "2", text: "Upload the marked resume here" },
                  { step: "3", text: "Edit text in each block section" },
                  { step: "4", text: "Preview changes and download" },
                ].map((item) => (
                  <div key={item.step} className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                      {item.step}
                    </span>
                    <span className="text-sm text-muted-foreground">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 p-3 rounded-md bg-muted/50">
              <div className="flex gap-2">
                <AlertCircle className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div className="text-xs text-muted-foreground">
                  <p className="font-medium">Block Markers Required</p>
                  <p className="mt-1">
                    Your DOCX must contain markers like{" "}
                    <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">[[BLOCK:SKILLS]]</code>{" "}
                    and{" "}
                    <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">[[END:SKILLS]]</code>{" "}
                    around editable sections.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

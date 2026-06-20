import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  ProgressBar,
  Spinner,
  TableCell,
  TableCellLayout,
  Tooltip,
} from "@fluentui/react-components";
import {
  bundleIcon,
  CheckmarkCircleFilled,
  CheckmarkCircleRegular,
  DismissCircleFilled,
  DismissCircleRegular,
  DocumentAddFilled,
  DocumentAddRegular,
  InfoFilled,
  InfoRegular,
  WarningFilled,
  WarningRegular,
} from "@fluentui/react-icons";
import { asError } from "catch-unknown";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useToast from "@/hooks/useToast";
import { captureException } from "@/renderer/logging";
import { useEmbedder } from "@/renderer/next/hooks/remote/use-embedder";
import type { DocumentManager } from "@/main/services/document-manager";

type FilePreCheckResult = DocumentManager.FilePreCheckResult;
type PreCheckResult = DocumentManager.PreCheckResult;

type ImportWizardProps = {
  collectionId: string;
  collectionName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete?: (jobId: string) => void;
};

type WizardStep = "select-files" | "pre-check" | "confirm" | "importing";

const AddDocumentIcon = bundleIcon(DocumentAddFilled, DocumentAddRegular);
const SuccessIcon = bundleIcon(CheckmarkCircleFilled, CheckmarkCircleRegular);
const WarningIcon = bundleIcon(WarningFilled, WarningRegular);
const ErrorIcon = bundleIcon(DismissCircleFilled, DismissCircleRegular);
const InfoIcon = bundleIcon(InfoFilled, InfoRegular);

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
};

export default function ImportWizard(props: ImportWizardProps) {
  const { collectionId, collectionName, open, onOpenChange, onImportComplete } = props;
  const { t } = useTranslation();
  const { notifySuccess, notifyError } = useToast();
  const embedder = useEmbedder();
  const embedderReady = embedder.status.type === "ready";

  const [step, setStep] = useState<WizardStep>("select-files");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [preCheckResult, setPreCheckResult] = useState<PreCheckResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);

  const resetWizard = useCallback(() => {
    setStep("select-files");
    setSelectedFiles([]);
    setPreCheckResult(null);
    setIsChecking(false);
    setIsImporting(false);
    setImportProgress(0);
  }, []);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        resetWizard();
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, resetWizard],
  );

  const handleSelectFiles = useCallback(async () => {
    try {
      const files = await window.bridge.documentManager.selectFilesFromFileSystem();
      if (files && files.length > 0) {
        setSelectedFiles(files);
        setStep("pre-check");
        runPreCheck(files);
      }
    } catch (err) {
      const error = asError(err);
      captureException(error);
      notifyError(error.message);
    }
  }, [notifyError]);

  const runPreCheck = useCallback(
    async (files: string[]) => {
      setIsChecking(true);
      try {
        const result = await window.bridge.documentManager.preCheckImport({
          collection: collectionId,
          urls: files,
        });
        setPreCheckResult(result);
      } catch (err) {
        const error = asError(err);
        captureException(error);
        notifyError(error.message);
      } finally {
        setIsChecking(false);
      }
    },
    [collectionId, notifyError],
  );

  const handleBackToSelect = useCallback(() => {
    setStep("select-files");
    setPreCheckResult(null);
  }, []);

  const handleContinue = useCallback(() => {
    setStep("confirm");
  }, []);

  const handleBackToPreCheck = useCallback(() => {
    setStep("pre-check");
  }, []);

  const handleImport = useCallback(async () => {
    if (!preCheckResult) return;

    setIsImporting(true);
    setStep("importing");
    setImportProgress(0);

    try {
      const job = await window.bridge.documentManager.importDocumentsWithPreCheck({
        collection: collectionId,
        collectionName: collectionName,
        files: preCheckResult.files,
      });

      setImportProgress(100);
      notifySuccess(
        t("Knowledge.Notification.ImportSuccess", {
          defaultValue: "{{count}} files added to processing queue",
          count: Object.keys(job.documents).length,
        }),
      );
      onImportComplete?.(job.id);

      setTimeout(() => {
        handleOpenChange(false);
      }, 1200);
    } catch (err) {
      const error = asError(err);
      captureException(error);
      notifyError(error.message);
      setStep("confirm");
    } finally {
      setIsImporting(false);
    }
  }, [preCheckResult, collectionId, collectionName, notifySuccess, notifyError, t, onImportComplete, handleOpenChange]);

  const validFiles = useMemo(
    () => preCheckResult?.files.filter((f) => f.status === "valid") || [],
    [preCheckResult],
  );
  const duplicateFiles = useMemo(
    () => preCheckResult?.files.filter((f) => f.status === "duplicate") || [],
    [preCheckResult],
  );
  const errorFiles = useMemo(
    () => preCheckResult?.files.filter((f) => f.status === "error") || [],
    [preCheckResult],
  );

  const canProceedToConfirm = useMemo(
    () => preCheckResult && preCheckResult.validCount > 0,
    [preCheckResult],
  );

  const renderStepContent = () => {
    switch (step) {
      case "select-files":
        return (
          <div className="flex flex-col items-center justify-center py-8">
            <AddDocumentIcon fontSize={48} className="text-gray-400 mb-4" />
            <p className="text-lg font-medium mb-2">
              {t("Knowledge.ImportWizard.SelectFilesTitle", { defaultValue: "Select files to import" })}
            </p>
            <p className="text-sm text-gray-500 mb-6 text-center">
              {t("Knowledge.ImportWizard.SelectFilesDescription", {
                defaultValue: "Supported formats: PDF, DOCX, XLSX, PPTX, TXT, MD, JSON, CSV, etc.",
              })}
            </p>
            <Button appearance="primary" onClick={handleSelectFiles}>
              {t("Knowledge.ImportWizard.BrowseFiles", { defaultValue: "Browse Files" })}
            </Button>
          </div>
        );

      case "pre-check":
        return (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {t("Knowledge.ImportWizard.PreCheckTitle", { defaultValue: "File Pre-check" })}
              </p>
              {isChecking && (
                <div className="flex items-center gap-2">
                  <Spinner size="extra-tiny" />
                  <span className="text-xs text-gray-500">
                    {t("Knowledge.ImportWizard.Checking", { defaultValue: "Checking..." })}
                  </span>
                </div>
              )}
            </div>

            {preCheckResult && (
              <div className="flex gap-4 mb-2">
                <div className="flex items-center gap-1.5">
                  <SuccessIcon fontSize={16} className="text-green-500" />
                  <span className="text-sm">
                    {t("Knowledge.ImportWizard.Valid", { defaultValue: "Valid" })}:{" "}
                    <span className="font-medium">{preCheckResult.validCount}</span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <WarningIcon fontSize={16} className="text-yellow-500" />
                  <span className="text-sm">
                    {t("Knowledge.ImportWizard.Duplicates", { defaultValue: "Duplicates" })}:{" "}
                    <span className="font-medium">{preCheckResult.duplicateCount}</span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ErrorIcon fontSize={16} className="text-red-500" />
                  <span className="text-sm">
                    {t("Knowledge.ImportWizard.Errors", { defaultValue: "Errors" })}:{" "}
                    <span className="font-medium">{preCheckResult.errorCount}</span>
                  </span>
                </div>
              </div>
            )}

            <div className="border rounded-lg max-h-64 overflow-y-auto">
              {isChecking ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner label={t("Knowledge.ImportWizard.CheckingFiles", { defaultValue: "Checking files..." })} />
                </div>
              ) : preCheckResult ? (
                <div className="divide-y">
                  {preCheckResult.files.map((file, index) => (
                    <FileRow key={index} file={file} />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        );

      case "confirm":
        return (
          <div className="flex flex-col gap-4">
            <p className="text-sm font-medium">
              {t("Knowledge.ImportWizard.ConfirmTitle", { defaultValue: "Confirm Import" })}
            </p>

            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  {t("Knowledge.ImportWizard.TargetCollection", { defaultValue: "Target Collection" })}:
                </span>
                <span className="font-medium">{collectionName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  {t("Knowledge.ImportWizard.FilesToImport", { defaultValue: "Files to Import" })}:
                </span>
                <span className="font-medium">{validFiles.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  {t("Knowledge.ImportWizard.EstimatedChunks", { defaultValue: "Estimated Chunks" })}:
                </span>
                <span className="font-medium">{preCheckResult?.totalEstimatedChunks || 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  {t("Knowledge.ImportWizard.EmbedderStatus", { defaultValue: "Embedder Status" })}:
                </span>
                <span className={`font-medium ${embedderReady ? "text-green-600" : "text-red-600"}`}>
                  {embedderReady
                    ? t("Knowledge.ImportWizard.Ready", { defaultValue: "Ready" })
                    : t("Knowledge.ImportWizard.NotReady", { defaultValue: "Not Ready" })}
                </span>
              </div>
            </div>

            {!embedderReady && (
              <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <WarningIcon fontSize={16} className="text-yellow-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-yellow-800">
                    {t("Knowledge.FileDrawer.DialogTitle.EmbeddingModelIsMissing")}
                  </p>
                  <p className="text-xs text-yellow-700 mt-1">
                    {t("Knowledge.FileDrawer.DialogContent.EmbeddingModelIsRequired")}
                  </p>
                </div>
              </div>
            )}

            {duplicateFiles.length > 0 && (
              <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <InfoIcon fontSize={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-blue-800">
                    {t("Knowledge.ImportWizard.DuplicatesNote", {
                      defaultValue: "{{count}} duplicate files will be skipped",
                      count: duplicateFiles.length,
                    })}
                  </p>
                </div>
              </div>
            )}

            {errorFiles.length > 0 && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <ErrorIcon fontSize={16} className="text-red-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-red-800">
                    {t("Knowledge.ImportWizard.ErrorsNote", {
                      defaultValue: "{{count}} files have errors and will be skipped",
                      count: errorFiles.length,
                    })}
                  </p>
                </div>
              </div>
            )}
          </div>
        );

      case "importing":
        return (
          <div className="flex flex-col items-center justify-center py-8">
            <Spinner size="large" />
            <p className="text-lg font-medium mt-4">
              {t("Knowledge.ImportWizard.Importing", { defaultValue: "Importing files..." })}
            </p>
            <p className="text-sm text-gray-500 mt-2">
              {t("Knowledge.ImportWizard.ImportingDescription", {
                defaultValue: "Documents are being added to the processing queue.",
              })}
            </p>
            <div className="w-full max-w-xs mt-6">
              <ProgressBar value={importProgress} />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const renderActions = () => {
    switch (step) {
      case "select-files":
        return (
          <>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="secondary">{t("Common.Cancel")}</Button>
            </DialogTrigger>
          </>
        );

      case "pre-check":
        return (
          <>
            <Button appearance="secondary" onClick={handleBackToSelect}>
              {t("Common.Back")}
            </Button>
            <Button
              appearance="primary"
              onClick={handleContinue}
              disabled={isChecking || !canProceedToConfirm}
            >
              {t("Common.Continue")}
            </Button>
          </>
        );

      case "confirm":
        return (
          <>
            <Button appearance="secondary" onClick={handleBackToPreCheck}>
              {t("Common.Back")}
            </Button>
            <Button
              appearance="primary"
              onClick={handleImport}
              disabled={isImporting || !canProceedToConfirm}
            >
              {t("Common.Import")}
            </Button>
          </>
        );

      case "importing":
        return null;

      default:
        return null;
    }
  };

  const title = {
    "select-files": t("Knowledge.ImportWizard.Title", { defaultValue: "Import Documents" }),
    "pre-check": t("Knowledge.ImportWizard.Title", { defaultValue: "Import Documents" }),
    confirm: t("Knowledge.ImportWizard.Title", { defaultValue: "Import Documents" }),
    importing: t("Knowledge.ImportWizard.Title", { defaultValue: "Import Documents" }),
  }[step];

  return (
    <Dialog open={open} onOpenChange={(_, data) => handleOpenChange(data.open)}>
      <DialogSurface className="min-w-[560px]">
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>{renderStepContent()}</DialogContent>
          <DialogActions>{renderActions()}</DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function FileRow({ file }: { file: FilePreCheckResult }) {
  const { t } = useTranslation();

  const statusConfig = {
    valid: {
      icon: <SuccessIcon fontSize={16} className="text-green-500" />,
      label: t("Knowledge.ImportWizard.Valid", { defaultValue: "Valid" }),
      color: "text-green-600",
    },
    duplicate: {
      icon: <WarningIcon fontSize={16} className="text-yellow-500" />,
      label: t("Knowledge.ImportWizard.Duplicate", { defaultValue: "Duplicate" }),
      color: "text-yellow-600",
    },
    error: {
      icon: <ErrorIcon fontSize={16} className="text-red-500" />,
      label: t("Knowledge.ImportWizard.Error", { defaultValue: "Error" }),
      color: "text-red-600",
    },
  }[file.status];

  return (
    <div className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50">
      <div className="flex-shrink-0">{statusConfig.icon}</div>
      <div className="flex-1 min-w-0">
        <TableCellLayout truncate>
          <span className="text-sm font-medium">{file.name}</span>
        </TableCellLayout>
        <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
          <span>{formatFileSize(file.size)}</span>
          <span>·</span>
          <span>{file.mimetype}</span>
          {file.estimatedChunks > 0 && (
            <>
              <span>·</span>
              <span>
                {t("Knowledge.ImportWizard.EstimatedChunksShort", {
                  defaultValue: "{{count}} chunks",
                  count: file.estimatedChunks,
                })}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex-shrink-0">
        <Tooltip relationship="description" content={file.error || statusConfig.label}>
          <span className={`text-xs font-medium ${statusConfig.color}`}>{statusConfig.label}</span>
        </Tooltip>
      </div>
    </div>
  );
}

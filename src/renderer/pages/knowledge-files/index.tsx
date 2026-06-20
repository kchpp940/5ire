import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Tooltip,
} from "@fluentui/react-components";
import {
  bundleIcon,
  DocumentBulletListFilled,
  DocumentBulletListRegular,
} from "@fluentui/react-icons";
import { asError } from "catch-unknown";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import Empty from "renderer/components/Empty";
import useToast from "@/hooks/useToast";
import { captureException } from "@/renderer/logging";
import { useEmbedder } from "@/renderer/next/hooks/remote/use-embedder";
import { useLiveCollections } from "@/renderer/next/hooks/remote/use-live-collections";
import { useLiveImportJobs } from "@/renderer/next/hooks/remote/use-live-import-jobs";
import Grid from "./Grid";
import ImportWizard from "./ImportWizard";
import ImportTaskPanel from "./ImportTaskPanel";

const TasksIcon = bundleIcon(DocumentBulletListFilled, DocumentBulletListRegular);

const ImportButton = ({ onOpenWizard }: { onOpenWizard: () => void }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const embedder = useEmbedder();
  const ready = embedder.status.type === "ready";

  if (ready) {
    return (
      <Button appearance="primary" onClick={onOpenWizard}>
        {t("Common.Import")}
      </Button>
    );
  }

  return (
    <Dialog>
      <DialogTrigger disableButtonEnhancement>
        <Button appearance="primary">{t("Common.Import")}</Button>
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t("Knowledge.FileDrawer.DialogTitle.EmbeddingModelIsMissing")}</DialogTitle>
          <DialogContent>
            <p>{t("Knowledge.FileDrawer.DialogContent.EmbeddingModelIsRequired")}</p>
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="secondary">{t("Common.Cancel")}</Button>
            </DialogTrigger>
            <Button appearance="primary" onClick={() => navigate("/settings")}>
              {t("Common.GoSettings")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};

const TaskPanelButton = ({ onClick, hasActiveTasks }: { onClick: () => void; hasActiveTasks: boolean }) => {
  const { t } = useTranslation();

  return (
    <Tooltip relationship="label" content={t("Knowledge.ImportTaskPanel.Button", { defaultValue: "Import Tasks" })}>
      <Button
        icon={<TasksIcon />}
        appearance="subtle"
        onClick={onClick}
        className="relative"
      >
        {hasActiveTasks && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-500 rounded-full" />
        )}
      </Button>
    </Tooltip>
  );
};

export default function KnowledgeFiles() {
  const { id } = useParams();
  const { t } = useTranslation();

  const navigate = useNavigate();
  const toast = useToast();

  const collections = useLiveCollections();
  const importJobs = useLiveImportJobs();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const collection = useMemo(() => {
    if (!id) {
      return;
    }

    return collections.rows.find((collection) => collection.id === id);
  }, [collections, id]);

  const hasActiveTasks = useMemo(() => {
    return importJobs.some(
      (job) => job.pendingCount > 0 || job.processingCount > 0 || job.failedCount > 0,
    );
  }, [importJobs]);

  const handleImportComplete = (jobId: string) => {
    setActiveJobId(jobId);
    setTimeout(() => {
      setTaskPanelOpen(true);
    }, 1200);
  };

  return (
    <div className="page h-full">
      <div className="page-top-bar" />
      <div className="page-header">
        <div className="flex items-center justify-between w-full">
          <h1 className="text-2xl flex-shrink-0 mr-6 truncate flex-1">{collection?.name}</h1>
          <div className="flex justify-end items-center gap-2">
            <Button appearance="subtle" onClick={() => navigate(-1)}>
              {t("Common.Back")}
            </Button>
            {collection && (
              <>
                <TaskPanelButton
                  onClick={() => setTaskPanelOpen(true)}
                  hasActiveTasks={hasActiveTasks}
                />
                <ImportButton onOpenWizard={() => setWizardOpen(true)} />
              </>
            )}
          </div>
        </div>
      </div>
      <div className="mt-2.5 pb-12 h-full -mr-5 overflow-y-auto">
        {collection ? (
          <div className="mr-5 flex justify-start gap-2 flex-wrap">
            <Grid />
          </div>
        ) : (
          <Empty image="knowledge" text={t("No knowledge base yet.")} />
        )}
      </div>

      {collection && (
        <>
          <ImportWizard
            collectionId={collection.id}
            collectionName={collection.name}
            open={wizardOpen}
            onOpenChange={setWizardOpen}
            onImportComplete={handleImportComplete}
          />
          <ImportTaskPanel
            open={taskPanelOpen}
            onOpenChange={(open) => {
              setTaskPanelOpen(open);
              if (!open) {
                setActiveJobId(null);
              }
            }}
            activeJobId={activeJobId}
          />
        </>
      )}
    </div>
  );
}

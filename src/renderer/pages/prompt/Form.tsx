import {
  Button,
  Combobox,
  Option,
  Divider,
  Field,
  Input,
  Text,
  InputOnChangeData,
  InfoLabel,
  OptionGroup,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Textarea,
  Badge,
  Tab,
  TabList,
  TabValue,
} from '@fluentui/react-components';
import {
  BracesVariable20Regular,
  Save20Regular,
  Publish20Regular,
  History20Regular,
  Eye20Regular,
  Dismiss24Regular,
  Add20Regular,
  Delete20Regular,
} from '@fluentui/react-icons';
import useToast from 'hooks/useToast';
import {
  IPromptDef,
  IPromptVariableSchema,
  IPromptVersion,
} from 'intellichat/types';
import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import usePromptStore from 'stores/usePromptStore';
import { parseVariables, unix2date, fmtDateTime } from 'utils/util';
import { isBlank } from 'utils/validators';
import useProviderStore, { ModelOption } from 'stores/useProviderStore';

function MessageField({
  label,
  tooltip,
  value,
  onChange,
  variables,
}: {
  label: string;
  tooltip?: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  variables: string[];
}) {
  const { t } = useTranslation();
  return (
    <div>
      <Field
        label={tooltip ? <InfoLabel info={tooltip}>{label}</InfoLabel> : label}
      >
        <textarea
          className="fluent"
          style={{ minHeight: 180, resize: 'vertical' }}
          onChange={onChange}
          value={value}
        />
        <Text size={200} className="text-color-secondary mt-1">
          {t('Prompt.Form.Tooltip.Variable')}
        </Text>
      </Field>
      {variables.length ? (
        <Divider className="mt-2.5 mb-1.5">
          {label}
          {t('Common.Variables')}
          &nbsp;({variables.length})
        </Divider>
      ) : null}
      <div className="flex justify-start items-center gap-2 flex-wrap">
        {variables.map((variable: string) => (
          <div
            key={variable}
            className="tag-variable px-2.5 py-1.5 flex items-center justify-start"
          >
            <BracesVariable20Regular />
            &nbsp;{variable}
          </div>
        ))}
      </div>
    </div>
  );
}

function VariableSchemaEditor({
  title,
  schemas,
  onChange,
}: {
  title: string;
  schemas: IPromptVariableSchema[];
  onChange: (schemas: IPromptVariableSchema[]) => void;
}) {
  const { t } = useTranslation();

  const updateSchema = (index: number, field: keyof IPromptVariableSchema, value: any) => {
    const updated = [...schemas];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const removeSchema = (index: number) => {
    const updated = schemas.filter((_, i) => i !== index);
    onChange(updated);
  };

  if (schemas.length === 0) {
    return (
      <div>
        <div className="text-base font-medium mb-2">{title}</div>
        <Text size={200} className="text-color-secondary">
          {t('Prompt.Form.NoVariables')}
        </Text>
      </div>
    );
  }

  return (
    <div>
      <div className="text-base font-medium mb-2">{title}</div>
      <div className="flex flex-col gap-3">
        {schemas.map((schema, index) => (
          <div
            key={schema.name}
            className="p-3 border border-colorNeutralStroke1 rounded-md"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <BracesVariable20Regular />
                <span className="font-medium">{schema.name}</span>
              </div>
              <Button
                appearance="subtle"
                icon={<Delete20Regular />}
                onClick={() => removeSchema(index)}
                aria-label={t('Common.Delete')}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Field label={t('Prompt.Form.VariableDescription')}>
                <Input
                  value={schema.description || ''}
                  placeholder={t('Common.Optional')}
                  onChange={(e, data) =>
                    updateSchema(index, 'description', data.value)
                  }
                />
              </Field>
              <Field label={t('Prompt.Form.VariableDefaultValue')}>
                <Textarea
                  value={schema.defaultValue || ''}
                  placeholder={t('Common.Optional')}
                  onChange={(e, data) =>
                    updateSchema(index, 'defaultValue', data.value)
                  }
                />
              </Field>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`required-${schema.name}`}
                  checked={!!schema.required}
                  onChange={(e) =>
                    updateSchema(index, 'required', e.target.checked)
                  }
                />
                <label htmlFor={`required-${schema.name}`}>
                  {t('Prompt.Form.VariableRequired')}
                </label>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewPanel({
  systemMessage,
  userMessage,
  systemSchemas,
  userSchemas,
}: {
  systemMessage: string;
  userMessage: string;
  systemSchemas: IPromptVariableSchema[];
  userSchemas: IPromptVariableSchema[];
}) {
  const { t } = useTranslation();
  const buildVariableSchemas = usePromptStore(
    (state) => state.buildVariableSchemas,
  );
  const renderPromptPreview = usePromptStore(
    (state) => state.renderPromptPreview,
  );

  const [systemVars, setSystemVars] = useState<{ [key: string]: string }>({});
  const [userVars, setUserVars] = useState<{ [key: string]: string }>({});
  const [effectiveSystemSchemas, setEffectiveSystemSchemas] = useState<
    IPromptVariableSchema[]
  >([]);
  const [effectiveUserSchemas, setEffectiveUserSchemas] = useState<
    IPromptVariableSchema[]
  >([]);
  const [preview, setPreview] = useState<{
    systemMessage: string;
    userMessage: string;
  }>({ systemMessage: '', userMessage: '' });

  useEffect(() => {
    const fetchSchemas = async () => {
      const built = await buildVariableSchemas(
        systemMessage,
        userMessage,
        systemSchemas,
        userSchemas,
      );
      setEffectiveSystemSchemas(built.systemVariableSchemas);
      setEffectiveUserSchemas(built.userVariableSchemas);
    };
    fetchSchemas();
  }, [systemMessage, userMessage, systemSchemas, userSchemas]);

  useEffect(() => {
    const defaults: { [key: string]: string } = {};
    effectiveSystemSchemas.forEach((s) => {
      if (s.defaultValue) defaults[s.name] = s.defaultValue;
    });
    setSystemVars(defaults);
  }, [effectiveSystemSchemas]);

  useEffect(() => {
    const defaults: { [key: string]: string } = {};
    effectiveUserSchemas.forEach((s) => {
      if (s.defaultValue) defaults[s.name] = s.defaultValue;
    });
    setUserVars(defaults);
  }, [effectiveUserSchemas]);

  useEffect(() => {
    const fetchPreview = async () => {
      const result = await renderPromptPreview(
        systemMessage,
        userMessage,
        systemVars,
        userVars,
      );
      setPreview(result);
    };
    fetchPreview();
  }, [systemMessage, userMessage, systemVars, userVars]);

  return (
    <div className="flex flex-col gap-4">
      {(effectiveSystemSchemas.length > 0 || effectiveUserSchemas.length > 0) && (
        <div className="flex flex-col gap-4">
          {effectiveSystemSchemas.length > 0 && (
            <div>
              <div className="text-base font-medium mb-2">
                {t('Common.SystemMessage')} {t('Common.Variables')}
              </div>
              {effectiveSystemSchemas.map((schema) => (
                <Field
                  key={schema.name}
                  label={
                    <InfoLabel info={schema.description}>
                      {schema.name}
                      {schema.required && (
                        <span className="text-colorPaletteRedBackground1">
                          {' '}
                          *
                        </span>
                      )}
                    </InfoLabel>
                  }
                  className="my-2"
                >
                  <Textarea
                    className="w-full"
                    value={systemVars[schema.name] || ''}
                    placeholder={schema.defaultValue || t('Common.Required')}
                    onChange={(e, data) =>
                      setSystemVars({
                        ...systemVars,
                        [schema.name]: data.value,
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          )}
          {effectiveUserSchemas.length > 0 && (
            <div>
              <div className="text-base font-medium mb-2">
                {t('Common.UserMessage')} {t('Common.Variables')}
              </div>
              {effectiveUserSchemas.map((schema) => (
                <Field
                  key={schema.name}
                  label={
                    <InfoLabel info={schema.description}>
                      {schema.name}
                      {schema.required && (
                        <span className="text-colorPaletteRedBackground1">
                          {' '}
                          *
                        </span>
                      )}
                    </InfoLabel>
                  }
                  className="my-2"
                >
                  <Textarea
                    className="w-full"
                    value={userVars[schema.name] || ''}
                    placeholder={schema.defaultValue || t('Common.Required')}
                    onChange={(e, data) =>
                      setUserVars({
                        ...userVars,
                        [schema.name]: data.value,
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          )}
        </div>
      )}
      <Divider>{t('Common.Preview')}</Divider>
      {systemMessage && (
        <div>
          <div className="text-sm font-medium text-color-secondary mb-1">
            {t('Common.SystemMessage')}:
          </div>
          <div className="p-3 bg-colorNeutralBackground3 rounded whitespace-pre-wrap">
            {preview.systemMessage}
          </div>
        </div>
      )}
      {userMessage && (
        <div>
          <div className="text-sm font-medium text-color-secondary mb-1">
            {t('Common.UserMessage')}:
          </div>
          <div className="p-3 bg-colorNeutralBackground3 rounded whitespace-pre-wrap">
            {preview.userMessage}
          </div>
        </div>
      )}
    </div>
  );
}

function VersionHistoryPanel({
  promptId,
  onRestore,
}: {
  promptId: string;
  onRestore: (version: IPromptVersion) => void;
}) {
  const { t } = useTranslation();
  const listVersions = usePromptStore((state) => state.listVersions);
  const versions = usePromptStore((state) => state.versions);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (promptId) {
      setLoading(true);
      listVersions(promptId).finally(() => setLoading(false));
    }
  }, [promptId]);

  if (loading) {
    return <div>{t('Common.Loading')}</div>;
  }

  if (versions.length === 0) {
    return (
      <Text size={200} className="text-color-secondary">
        {t('Prompt.Form.NoVersions')}
      </Text>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {versions.map((version) => (
        <div
          key={version.id}
          className="p-3 border border-colorNeutralStroke1 rounded-md"
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Badge appearance="filled">v{version.version}</Badge>
              <span className="font-medium">{version.name}</span>
            </div>
            <Text size={200} className="text-color-secondary">
              {fmtDateTime(unix2date(version.publishedAt))}
            </Text>
          </div>
          {version.changelog && (
            <Text size={200} className="text-color-secondary block mb-2">
              {version.changelog}
            </Text>
          )}
          <Button
            size="small"
            appearance="subtle"
            onClick={() => onRestore(version)}
          >
            {t('Prompt.Form.RestoreVersion')}
          </Button>
        </div>
      ))}
    </div>
  );
}

export default function Form() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { getGroupedModelOptions } = useProviderStore();
  const [name, setName] = useState<string>('');
  const [models, setModels] = useState<string[]>([]);
  const [systemMessage, setSystemMessage] = useState<string>('');
  const [userMessage, setUserMessage] = useState<string>('');
  const [systemVariables, setSystemVariables] = useState<string[]>([]);
  const [userVariables, setUserVariables] = useState<string[]>([]);
  const [systemVariableSchemas, setSystemVariableSchemas] = useState<
    IPromptVariableSchema[]
  >([]);
  const [userVariableSchemas, setUserVariableSchemas] = useState<
    IPromptVariableSchema[]
  >([]);
  const [changelog, setChangelog] = useState<string>('');
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabValue>('edit');
  const [hasDraft, setHasDraft] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const createPrompt = usePromptStore((state) => state.createPrompt);
  const updatePrompt = usePromptStore((state) => state.updatePrompt);
  const getPrompt = usePromptStore((state) => state.getPrompt);
  const saveDraft = usePromptStore((state) => state.saveDraft);
  const getDraft = usePromptStore((state) => state.getDraft);
  const publishVersion = usePromptStore((state) => state.publishVersion);
  const buildVariableSchemas = usePromptStore(
    (state) => state.buildVariableSchemas,
  );
  const { notifyInfo, notifySuccess, notifyError } = useToast();
  const [modelOptions, setModelOptions] = useState<{
    [key: string]: ModelOption[];
  }>({});

  const selectedModelLabels = useMemo(() => {
    return Object.keys(modelOptions).reduce((acc, group) => {
      const options = modelOptions[group].filter((option) =>
        models.includes(option.name),
      );
      if (options.length) {
        acc.push(...options.map((option) => `${group}/${option.label}`));
      }
      return acc;
    }, [] as string[]);
  }, [modelOptions, models]);

  type PromptPayload = { id: string } & Partial<IPromptDef>;

  const loadModels = useCallback(async () => {
    const options = await getGroupedModelOptions();
    setModelOptions(options);
  }, []);

  useEffect(() => {
    loadModels();
  }, []);

  useEffect(() => {
    if (id) {
      getPrompt(id)
        .then(($prompt) => {
          setName($prompt.name || '');
          setModels($prompt.models || []);
          setSystemMessage($prompt.systemMessage || '');
          setUserMessage($prompt.userMessage || '');
          setSystemVariableSchemas($prompt.systemVariableSchemas || []);
          setUserVariableSchemas($prompt.userVariableSchemas || []);
          return $prompt;
        })
        .catch(() => {
          notifyError(t('Prompt.Notifications.PromptNotFound'));
        });
      getDraft(id).then((draft) => {
        if (draft) {
          setHasDraft(true);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const updateSystemMessage = async () => {
      const vars = parseVariables(systemMessage);
      setSystemVariables(vars);
      const built = await buildVariableSchemas(
        systemMessage,
        userMessage,
        systemVariableSchemas,
        userVariableSchemas,
      );
      setSystemVariableSchemas(built.systemVariableSchemas);
      setIsEditing(true);
    };
    updateSystemMessage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemMessage]);

  useEffect(() => {
    const updateUserMessage = async () => {
      const vars = parseVariables(userMessage);
      setUserVariables(vars);
      const built = await buildVariableSchemas(
        systemMessage,
        userMessage,
        systemVariableSchemas,
        userVariableSchemas,
      );
      setUserVariableSchemas(built.userVariableSchemas);
      setIsEditing(true);
    };
    updateUserMessage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userMessage]);

  const onSystemMessageChange = (e: any) => {
    setSystemMessage(e.target.value);
  };

  const onUserMessageChange = (e: any) => {
    setUserMessage(e.target.value);
  };

  const onModelSelect = (e: any, data: any) => {
    setModels(data.selectedOptions);
    setIsEditing(true);
  };

  const validate = (): boolean => {
    if (isBlank(name)) {
      notifyInfo(t('Notification.NameRequired'));
      return false;
    }
    if (isBlank(userMessage) && isBlank(systemMessage)) {
      notifyInfo(t('Prompt.Notifications.MessageRequired'));
      return false;
    }
    return true;
  };

  const onSaveDraft = async () => {
    if (!id) {
      notifyInfo(t('Prompt.Notifications.SaveDraftRequiresPrompt'));
      return;
    }
    const schemas = await buildVariableSchemas(
      systemMessage,
      userMessage,
      systemVariableSchemas,
      userVariableSchemas,
    );
    await saveDraft({
      promptId: id,
      name,
      systemMessage,
      userMessage,
      systemVariableSchemas: schemas.systemVariableSchemas,
      userVariableSchemas: schemas.userVariableSchemas,
      models,
    });
    setHasDraft(true);
    setIsEditing(false);
    notifySuccess(t('Prompt.Notifications.DraftSaved'));
  };

  const onLoadDraft = async () => {
    if (!id) return;
    const draft = await getDraft(id);
    if (draft) {
      setName(draft.name);
      setSystemMessage(draft.systemMessage);
      setUserMessage(draft.userMessage);
      setSystemVariableSchemas(draft.systemVariableSchemas || []);
      setUserVariableSchemas(draft.userVariableSchemas || []);
      setModels(draft.models || []);
      notifySuccess(t('Prompt.Notifications.DraftLoaded'));
    }
  };

  const onSave = async () => {
    if (!validate()) return;
    const schemas = await buildVariableSchemas(
      systemMessage,
      userMessage,
      systemVariableSchemas,
      userVariableSchemas,
    );
    const $prompt = {
      id,
      name,
      userMessage,
      models,
      userVariables,
      systemVariableSchemas: schemas.systemVariableSchemas,
      userVariableSchemas: schemas.userVariableSchemas,
    } as PromptPayload;
    $prompt.systemMessage = systemMessage;
    $prompt.systemVariables = systemVariables;
    if ($prompt.id) {
      await updatePrompt($prompt);
      notifySuccess(t('Prompt.Notifications.PromptUpdated'));
    } else {
      await createPrompt($prompt);
      notifySuccess(t('Prompt.Notifications.PromptCreated'));
    }
    setIsEditing(false);
    navigate(-1);
  };

  const onPublish = async () => {
    if (!id) {
      onSave();
      return;
    }
    if (!validate()) return;
    const schemas = await buildVariableSchemas(
      systemMessage,
      userMessage,
      systemVariableSchemas,
      userVariableSchemas,
    );
    await publishVersion({
      promptId: id,
      name,
      systemMessage,
      userMessage,
      systemVariableSchemas: schemas.systemVariableSchemas,
      userVariableSchemas: schemas.userVariableSchemas,
      models,
      changelog,
    });
    setPublishDialogOpen(false);
    setChangelog('');
    setHasDraft(false);
    setIsEditing(false);
    notifySuccess(t('Prompt.Notifications.VersionPublished'));
  };

  const onRestoreVersion = (version: IPromptVersion) => {
    setName(version.name);
    setSystemMessage(version.systemMessage);
    setUserMessage(version.userMessage);
    setSystemVariableSchemas(version.systemVariableSchemas || []);
    setUserVariableSchemas(version.userVariableSchemas || []);
    setModels(version.models || []);
    setIsEditing(true);
    notifySuccess(t('Prompt.Notifications.VersionRestored'));
  };

  return (
    <div className="page h-full">
      <div className="page-top-bar" />
      <div className="page-header flex items-center justify-between">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl flex-shrink-0 mr-6">{t('Common.Prompts')}</h1>
            {id && isEditing && (
              <Badge appearance="warning">{t('Prompt.Form.UnsavedChanges')}</Badge>
            )}
            {hasDraft && (
              <Badge appearance="informative">{t('Prompt.Form.HasDraft')}</Badge>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button appearance="subtle" onClick={() => navigate(-1)}>
              {t('Common.Cancel')}
            </Button>
            {id && (
              <>
                {hasDraft && (
                  <Button appearance="subtle" onClick={onLoadDraft}>
                    {t('Prompt.Form.LoadDraft')}
                  </Button>
                )}
                <Button
                  appearance="secondary"
                  icon={<Save20Regular />}
                  onClick={onSaveDraft}
                  disabled={!isEditing}
                >
                  {t('Prompt.Form.SaveDraft')}
                </Button>
                <Dialog
                  open={publishDialogOpen}
                  onOpenChange={(_e, data) =>
                    setPublishDialogOpen(data.open as boolean)
                  }
                >
                  <DialogTrigger disableButtonEnhancement>
                    <Button
                      appearance="primary"
                      icon={<Publish20Regular />}
                      disabled={!isEditing}
                    >
                      {t('Prompt.Form.PublishVersion')}
                    </Button>
                  </DialogTrigger>
                  <DialogSurface>
                    <DialogBody>
                      <DialogTitle
                        action={
                          <DialogTrigger action="close">
                            <Button
                              appearance="subtle"
                              aria-label="close"
                              icon={<Dismiss24Regular />}
                            />
                          </DialogTrigger>
                        }
                      >
                        {t('Prompt.Form.PublishNewVersion')}
                      </DialogTitle>
                      <DialogContent>
                        <Field label={t('Prompt.Form.Changelog')}>
                          <Textarea
                            value={changelog}
                            onChange={(e, data) => setChangelog(data.value)}
                            placeholder={t('Prompt.Form.ChangelogPlaceholder')}
                          />
                        </Field>
                      </DialogContent>
                      <DialogActions>
                        <DialogTrigger disableButtonEnhancement>
                          <Button appearance="subtle">{t('Common.Cancel')}</Button>
                        </DialogTrigger>
                        <Button appearance="primary" onClick={onPublish}>
                          {t('Common.Publish')}
                        </Button>
                      </DialogActions>
                    </DialogBody>
                  </DialogSurface>
                </Dialog>
              </>
            )}
            {!id && (
              <Button appearance="primary" onClick={onSave}>
                {t('Common.Save')}
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="mt-2.5 pb-12 h-full -mr-5 overflow-y-auto">
        <div className="mr-5 flex flex-col">
          <TabList selectedValue={activeTab} onTabSelect={(_e, data) => setActiveTab(data.value)}>
            <Tab value="edit">{t('Common.Edit')}</Tab>
            <Tab value="variables">
              <BracesVariable20Regular className="mr-1" />
              {t('Common.Variables')}
            </Tab>
            <Tab value="preview">
              <Eye20Regular className="mr-1" />
              {t('Common.Preview')}
            </Tab>
            {id && (
              <Tab value="history">
                <History20Regular className="mr-1" />
                {t('Prompt.Form.VersionHistory')}
              </Tab>
            )}
          </TabList>
          <div className="mt-4">
            {activeTab === 'edit' && (
              <div>
                <div className="mb-2.5">
                  <Field label={t('Common.Name')}>
                    <Input
                      value={name}
                      placeholder={t('Common.Required')}
                      onChange={(
                        ev: ChangeEvent<HTMLInputElement>,
                        data: InputOnChangeData,
                      ) => {
                        setName(data.value || '');
                        setIsEditing(true);
                      }}
                    />
                  </Field>
                </div>
                <div className="mb-2.5">
                  <Field label={t('Prompt.Form.ApplicableModels')}>
                    <Combobox
                      aria-labelledby="models"
                      multiselect
                      placeholder={
                        selectedModelLabels.length
                          ? selectedModelLabels.join(', ')
                          : t('Common.Optional')
                      }
                      selectedOptions={models}
                      onOptionSelect={onModelSelect}
                    >
                      {Object.keys(modelOptions).map((group: string) => (
                        <OptionGroup label={group} key={group}>
                          {modelOptions[group].map(
                            (option: { name: string; label: string }) => (
                              <Option
                                key={`${group}-${option.name}`}
                                aria-label={option.label}
                                text={option.label}
                                value={option.name}
                              >
                                {option.label || option.name}
                              </Option>
                            ),
                          )}
                        </OptionGroup>
                      ))}
                    </Combobox>
                  </Field>
                  <Text size={200} className="text-color-secondary">
                    {t('Prompt.Form.Tooltip.ApplicableModels')}
                  </Text>
                </div>
                <div className="mb-2.5">
                  <MessageField
                    label={t('Common.SystemMessage')}
                    tooltip={t('Tooltip.SystemMessage')}
                    value={systemMessage}
                    onChange={onSystemMessageChange}
                    variables={systemVariables}
                  />
                </div>
                <div className="mb-2.5">
                  <MessageField
                    label={t('Common.UserMessage')}
                    value={userMessage}
                    onChange={onUserMessageChange}
                    variables={userVariables}
                  />
                </div>
              </div>
            )}
            {activeTab === 'variables' && (
              <div className="flex flex-col gap-6">
                <VariableSchemaEditor
                  title={`${t('Common.SystemMessage')} ${t('Common.Variables')}`}
                  schemas={systemVariableSchemas}
                  onChange={setSystemVariableSchemas}
                />
                <VariableSchemaEditor
                  title={`${t('Common.UserMessage')} ${t('Common.Variables')}`}
                  schemas={userVariableSchemas}
                  onChange={setUserVariableSchemas}
                />
              </div>
            )}
            {activeTab === 'preview' && (
              <PreviewPanel
                systemMessage={systemMessage}
                userMessage={userMessage}
                systemSchemas={systemVariableSchemas}
                userSchemas={userVariableSchemas}
              />
            )}
            {activeTab === 'history' && id && (
              <VersionHistoryPanel
                promptId={id}
                onRestore={onRestoreVersion}
              />
            )}
          </div>
        </div>
        <div className="h-16" />
      </div>
    </div>
  );
}

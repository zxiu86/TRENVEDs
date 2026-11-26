/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { LandingPage } from './components/LandingPage';
import { SettingsModal, type SettingsTab } from './components/SettingsModal';
import { StudioWorkspace } from './components/StudioWorkspace';
import { loadStoredProviders, persistProviders } from './services/aiProviders';
import type { AiProviderConfig, Project, StudioSettings } from './types/studio';
import { createLocalProject } from './utils/studioLogic';

const DEFAULT_SETTINGS: StudioSettings = {
  defaultAspectRatio: '16:9',
  defaultFrameRate: 24,
  showGuidesByDefault: true,
  showLineNumbers: true,
};

export default function App() {
  const [settings, setSettings] = useState<StudioSettings>(DEFAULT_SETTINGS);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('preferences');

  const initialProviderState = useMemo(() => loadStoredProviders(), []);
  const [providers, setProviders] = useState<AiProviderConfig[]>(
    initialProviderState.providers
  );
  const [activeProviderId, setActiveProviderId] = useState<string | null>(
    initialProviderState.activeProviderId
  );

  // Persist providers according to each provider's explicit session vs local storage choice
  useEffect(() => {
    persistProviders(providers, activeProviderId);
  }, [providers, activeProviderId]);

  // Support ?autostart=1 to jump directly into a new Studio session when requested
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      const initial = createLocalProject(DEFAULT_SETTINGS, 0);
      setProjects([initial]);
      setActiveProjectId(initial.id);
    }
  }, []);

  const activeProvider = useMemo(() => {
    if (providers.length === 0) return null;
    if (activeProviderId) {
      const found = providers.find((p) => p.id === activeProviderId);
      if (found) return found;
    }
    return providers[0];
  }, [providers, activeProviderId]);

  const handleOpenSettings = (tab: SettingsTab = 'preferences') => {
    setSettingsInitialTab(tab);
    setIsSettingsOpen(true);
  };

  const handleSaveProvider = (saved: AiProviderConfig, setAsActive = false) => {
    setProviders((prev) => {
      const exists = prev.some((item) => item.id === saved.id);
      if (exists) {
        return prev.map((item) => (item.id === saved.id ? saved : item));
      }
      return [...prev, saved];
    });
    if (setAsActive || !activeProviderId) {
      setActiveProviderId(saved.id);
    }
  };

  const handleDeleteProvider = (providerId: string) => {
    setProviders((prev) => {
      const remaining = prev.filter((item) => item.id !== providerId);
      if (activeProviderId === providerId) {
        setActiveProviderId(remaining[0]?.id ?? null);
      }
      return remaining;
    });
  };

  const handleNewProject = () => {
    const created = createLocalProject(settings, projects.length);
    setProjects((prev) => [created, ...prev]);
    setActiveProjectId(created.id);
  };

  const handleOpenProject = (projectId: string) => {
    setActiveProjectId(projectId);
  };

  const handleDeleteProject = (projectId: string) => {
    setProjects((prev) => prev.filter((item) => item.id !== projectId));
    if (activeProjectId === projectId) {
      setActiveProjectId(null);
    }
  };

  const handleUpdateProject = (updated: Project) => {
    setProjects((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
  };

  const activeProject =
    activeProjectId !== null
      ? projects.find((item) => item.id === activeProjectId) ?? null
      : null;

  return (
    <div
      data-app-view={activeProject ? 'studio' : 'landing'}
      className="min-h-screen bg-[#060608] text-zinc-100"
    >
      <div
        key={activeProject ? `studio-${activeProject.id}` : 'landing-view'}
        className="studio-view-enter"
      >
        {activeProject ? (
          <StudioWorkspace
            project={activeProject}
            settings={settings}
            activeProvider={activeProvider}
            onBackToLanding={() => setActiveProjectId(null)}
            onUpdateProject={handleUpdateProject}
            onOpenSettings={handleOpenSettings}
          />
        ) : (
          <LandingPage
            projects={projects}
            onNewProject={handleNewProject}
            onOpenProject={handleOpenProject}
            onDeleteProject={handleDeleteProject}
            onOpenSettings={() => handleOpenSettings('preferences')}
          />
        )}
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        initialTab={settingsInitialTab}
        settings={settings}
        providers={providers}
        activeProviderId={activeProvider?.id ?? null}
        onUpdateSettings={setSettings}
        onSaveProvider={handleSaveProvider}
        onDeleteProvider={handleDeleteProvider}
        onSelectActiveProvider={setActiveProviderId}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}

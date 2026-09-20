import { useState } from 'react';
import '@src/Options.css';
import { Button } from '@extension/ui';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { t } from '@extension/i18n';
import { FiSettings, FiCpu, FiShield, FiTrendingUp, FiHelpCircle } from 'react-icons/fi';
import { GeneralSettings } from './components/GeneralSettings';
import { ModelSettings } from './components/ModelSettings';
import { FirewallSettings } from './components/FirewallSettings';
import { AnalyticsSettings } from './components/AnalyticsSettings';

type TabTypes = 'general' | 'models' | 'firewall' | 'analytics' | 'help';

const TABS: { id: TabTypes; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { id: 'general', icon: FiSettings, label: t('options_tabs_general') },
  { id: 'models', icon: FiCpu, label: t('options_tabs_models') },
  { id: 'firewall', icon: FiShield, label: t('options_tabs_firewall') },
  { id: 'analytics', icon: FiTrendingUp, label: 'Analytics' },
  { id: 'help', icon: FiHelpCircle, label: t('options_tabs_help') },
];

const Options = () => {
  const [activeTab, setActiveTab] = useState<TabTypes>('models');
  // Force bright/light theme — always false
  const isDarkMode = false;

  const handleTabClick = (tabId: TabTypes) => {
    if (tabId === 'help') {
      window.open('https://github.com', '_blank');
    } else {
      setActiveTab(tabId);
    }
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return <GeneralSettings isDarkMode={false} />;
      case 'models':
        return <ModelSettings isDarkMode={false} />;
      case 'firewall':
        return <FirewallSettings isDarkMode={false} />;
      case 'analytics':
        return <AnalyticsSettings isDarkMode={false} />;
      default:
        return null;
    }
  };

  return (
    <div
      className="flex min-h-screen min-w-[768px] text-gray-900"
      style={{ background: 'linear-gradient(160deg, #f0f9ff 0%, #e0f2fe 40%, #f8faff 100%)' }}>
      {/* Vertical Navigation Bar */}
      <nav
        className="w-48 border-r border-sky-200"
        style={{ background: 'linear-gradient(180deg, #ffffff 0%, #f0f9ff 100%)', boxShadow: '2px 0 8px rgba(14,165,233,0.08)' }}>
        <div className="p-4">
          <h1 className="mb-6 text-xl font-bold text-slate-800">
            {t('options_nav_header')}
          </h1>
          <ul className="space-y-1.5">
            {TABS.map(item => (
              <li key={item.id}>
                <Button
                  onClick={() => handleTabClick(item.id)}
                  className={`flex w-full items-center space-x-2 rounded-xl px-4 py-2.5 text-left text-sm font-medium transition-all duration-150
                    ${
                      activeTab === item.id
                        ? 'bg-gradient-to-r from-sky-500 to-indigo-500 text-white shadow-md shadow-sky-200'
                        : 'text-slate-600 hover:bg-sky-50 hover:text-sky-700'
                    }`}>
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 bg-white/60 p-8 backdrop-blur-sm">
        <div className="mx-auto min-w-[512px] max-w-screen-lg">{renderTabContent()}</div>
      </main>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <div>Loading...</div>), <div>Error Occurred</div>);

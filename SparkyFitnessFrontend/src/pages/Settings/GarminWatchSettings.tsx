import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Watch } from 'lucide-react';
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useClaimWatchPairingMutation,
  useWatchSyncStatusQuery,
} from '@/hooks/Settings/useWatchSync';
import { formatPairingCodeInput } from '@/utils/watchPairing';

export const GarminWatchSettings = () => {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const { data: status, isLoading } = useWatchSyncStatusQuery();
  const { mutate: claim, isPending } = useClaimWatchPairingMutation();
  const complete = code.replace('-', '').length === 8;

  return (
    <AccordionItem value="garmin-watch" className="border rounded-lg mb-4">
      <AccordionTrigger
        className="flex items-center gap-2 p-4 hover:no-underline"
        description={t(
          'settings.garminWatch.description',
          'Pair the Sparky Strength Connect IQ app and check its sync status'
        )}
      >
        <Watch className="h-5 w-5" />
        {t('settings.garminWatch.title', 'Garmin watch')}
      </AccordionTrigger>
      <AccordionContent className="p-4 pt-0 space-y-6">
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (complete) {
              claim(code, { onSuccess: () => setCode('') });
            }
          }}
        >
          <Label htmlFor="watch-pairing-code">
            {t(
              'settings.garminWatch.codeLabel',
              'Pairing code shown on the watch'
            )}
          </Label>
          <div className="flex gap-2 max-w-sm">
            <Input
              id="watch-pairing-code"
              value={code}
              onChange={(e) => setCode(formatPairingCodeInput(e.target.value))}
              placeholder="ABCD-EFGH"
              autoComplete="off"
              className="font-mono tracking-widest uppercase"
            />
            <Button type="submit" disabled={!complete || isPending}>
              {t('settings.garminWatch.pair', 'Pair')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              'settings.garminWatch.codeHelp',
              'On the watch, open Sparky Strength and choose "Pair watch". Pairing creates an API key named after the watch; delete that key under API Key Management to unpair it.'
            )}
          </p>
        </form>

        <div className="space-y-2">
          <h4 className="text-sm font-medium">
            {t('settings.garminWatch.statusTitle', 'Sync status')}
          </h4>
          {isLoading || !status ? (
            <p className="text-sm text-muted-foreground">
              {t('settings.garminWatch.loading', 'Loading…')}
            </p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted-foreground">
                {t('settings.garminWatch.sessions', 'Workouts uploaded')}
              </dt>
              <dd data-testid="watch-sessions-total">
                {status.sessions_total}
              </dd>
              <dt className="text-muted-foreground">
                {t(
                  'settings.garminWatch.linked',
                  'Linked to Garmin activities'
                )}
              </dt>
              <dd>{status.sessions_linked_to_garmin}</dd>
              <dt className="text-muted-foreground">
                {t('settings.garminWatch.lastUpload', 'Last upload')}
              </dt>
              <dd>
                {status.last_upload_at
                  ? new Date(status.last_upload_at).toLocaleString()
                  : t('settings.garminWatch.never', 'Never')}
              </dd>
            </dl>
          )}
          {status && status.devices.length > 0 && (
            <ul className="text-sm space-y-1">
              {status.devices.map((device) => (
                <li
                  key={device.device_id}
                  className="flex justify-between max-w-md"
                >
                  <span>
                    {device.device_model ?? device.device_id.slice(0, 8)}
                  </span>
                  <span className="text-muted-foreground">
                    {device.app_version ? `v${device.app_version} · ` : ''}
                    {new Date(device.last_seen_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
};

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Watch } from 'lucide-react';
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useClaimWatchPairingMutation,
  usePairedWatchesQuery,
  useUnpairWatchMutation,
  useWatchSyncStatusQuery,
} from '@/hooks/Settings/useWatchSync';
import {
  isCompleteWatchPairingCode,
  type WatchPairedDevice,
} from '@workspace/shared';
import { formatPairingCodeInput } from '@/utils/watchPairing';

export const GarminWatchSettings = () => {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const { data: status, isLoading } = useWatchSyncStatusQuery();
  const { mutate: claim, isPending } = useClaimWatchPairingMutation();
  const { data: paired } = usePairedWatchesQuery();
  const { mutate: unpair, isPending: isUnpairing } = useUnpairWatchMutation();
  const [toUnpair, setToUnpair] = useState<WatchPairedDevice | null>(null);
  const complete = isCompleteWatchPairingCode(code);

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
              'On the watch, open Sparky Strength and choose "Pair watch", then enter the code it shows. Each paired watch gets its own API key, which unpairing revokes.'
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
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium">
            {t('settings.garminWatch.devicesTitle', 'Paired watches')}
          </h4>
          {paired && paired.devices.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t('settings.garminWatch.noDevices', 'No watch is paired yet.')}
            </p>
          )}
          {paired && paired.devices.length > 0 && (
            <ul className="space-y-2 max-w-md">
              {paired.devices.map((device) => (
                <li
                  key={device.api_key_id}
                  data-testid="paired-watch"
                  className="flex items-center justify-between gap-4 text-sm"
                >
                  <div>
                    <div>
                      {device.device_model ??
                        t('settings.garminWatch.title', 'Garmin watch')}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {device.app_version ? `v${device.app_version} · ` : ''}
                      {t('settings.garminWatch.lastContact', 'Last contact')}
                      {': '}
                      {device.last_used_at
                        ? new Date(device.last_used_at).toLocaleString()
                        : t('settings.garminWatch.never', 'Never')}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isUnpairing}
                    onClick={() => setToUnpair(device)}
                  >
                    {t('settings.garminWatch.unpair', 'Unpair')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <AlertDialog
          open={toUnpair !== null}
          onOpenChange={(open) => !open && setToUnpair(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('settings.garminWatch.unpairTitle', 'Unpair this watch?')}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t(
                  'settings.garminWatch.unpairDescription',
                  'The watch can no longer download workouts or upload sessions until it is paired again. Workouts it has not uploaded yet stay on the watch.'
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t('settings.garminWatch.cancel', 'Cancel')}
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (toUnpair) unpair(toUnpair.api_key_id);
                  setToUnpair(null);
                }}
              >
                {t('settings.garminWatch.unpair', 'Unpair')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AccordionContent>
    </AccordionItem>
  );
};

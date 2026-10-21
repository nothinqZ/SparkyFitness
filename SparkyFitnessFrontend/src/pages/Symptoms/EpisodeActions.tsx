import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SymptomEntryResponse, SymptomScaleType } from '@workspace/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DateTimeInput } from '@/components/ui/TimeInput';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  useAddSeverityMutation,
  useCustomSymptoms,
  useEndEpisodeMutation,
  useUpdateSymptomEntryMutation,
} from '@/hooks/useSymptoms';
import type { MedicationDetail } from '@/types/medications';
import SeverityControl from './SeverityControl';
import TreatmentsEditor from './TreatmentsEditor';
import { fromDatetimeLocal, toDatetimeLocal } from './symptomHelpers';
import {
  minutesAgo,
  TIME_OFFSET_CHIPS,
  draftsFromEntry,
  draftsToInputs,
  type TreatmentDraft,
} from '@workspace/shared';

/** The severity scale an entry's symptom uses (1-10 when it has no definition). */
function useScaleFor(entry: SymptomEntryResponse): SymptomScaleType {
  const { data: definitions = [] } = useCustomSymptoms();
  return (
    definitions.find((d) => d.id === entry.symptom_id)?.scale_type ?? '1-10'
  );
}

interface EpisodeButtonProps {
  entry: SymptomEntryResponse;
  meds: MedicationDetail[];
}

/** Records a new severity reading on the episode's timeline. */
export function UpdateSeverityButton({
  entry,
}: {
  entry: SymptomEntryResponse;
}) {
  const { t } = useTranslation();
  const scale = useScaleFor(entry);
  const addSeverity = useAddSeverityMutation();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<number | null>(entry.severity);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          {t('symptoms.episode.updateSeverity', 'Update severity')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3">
        <SeverityControl
          id={`severity-${entry.id}`}
          scale={scale}
          value={value}
          onChange={setValue}
        />
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={value == null || addSeverity.isPending}
          onClick={() => {
            if (value == null) return;
            addSeverity.mutate(
              { id: entry.id, severity: value },
              { onSuccess: () => setOpen(false) }
            );
          }}
        >
          {t('symptoms.episode.saveReading', 'Save reading')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** Adds medications or relief methods to a running episode. */
export function AddReliefButton({ entry, meds }: EpisodeButtonProps) {
  const { t } = useTranslation();
  const update = useUpdateSymptomEntryMutation();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<TreatmentDraft[]>(() =>
    draftsFromEntry(entry)
  );

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          setDrafts(draftsFromEntry(entry));
          setOpen(true);
        }}
      >
        {t('symptoms.episode.addRelief', 'Add relief')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t('symptoms.episode.addRelief', 'Add relief')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'symptoms.episode.addReliefHint',
                'Record what you took or did, and whether it helped.'
              )}
            </DialogDescription>
          </DialogHeader>
          <TreatmentsEditor value={drafts} onChange={setDrafts} meds={meds} />
          <DialogFooter>
            <Button
              type="button"
              disabled={update.isPending}
              onClick={() =>
                update.mutate(
                  {
                    id: entry.id,
                    body: { treatments: draftsToInputs(drafts) },
                  },
                  { onSuccess: () => setOpen(false) }
                )
              }
            >
              {t('symptoms.chips.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Ends an episode, and asks whether the treatments helped. */
export function EndEpisodeButton({ entry, meds }: EpisodeButtonProps) {
  const { t } = useTranslation();
  const endEpisode = useEndEpisodeMutation();
  const [open, setOpen] = useState(false);
  const [endedAt, setEndedAt] = useState(() => new Date().toISOString());
  const [drafts, setDrafts] = useState<TreatmentDraft[]>(() =>
    draftsFromEntry(entry)
  );

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => {
          setEndedAt(new Date().toISOString());
          setDrafts(draftsFromEntry(entry));
          setOpen(true);
        }}
      >
        {t('symptoms.episode.end', 'End episode')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t('symptoms.episode.endTitle', 'End this episode')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'symptoms.episode.endHint',
                'Set when it ended, and mark what helped.'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label>{t('symptoms.episode.endedWhen', 'It ended')}</Label>
            <div className="flex flex-wrap gap-1.5">
              {TIME_OFFSET_CHIPS.filter((c) => c.minutes < 180).map((chip) => (
                <Button
                  key={chip.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-full px-3 text-xs"
                  onClick={() =>
                    setEndedAt(minutesAgo(chip.minutes).toISOString())
                  }
                >
                  {chip.minutes === 0
                    ? t('symptoms.form.now', 'Now')
                    : chip.minutes < 60
                      ? t('symptoms.form.minutesAgo', '−{{n}} min', {
                          n: chip.minutes,
                        })
                      : t('symptoms.form.hoursAgo', '−{{n}} h', {
                          n: chip.minutes / 60,
                        })}
                </Button>
              ))}
            </div>
            <DateTimeInput
              aria-label={t('symptoms.episode.endedWhen', 'It ended')}
              value={toDatetimeLocal(endedAt)}
              onChange={(value) => {
                const iso = fromDatetimeLocal(value);
                if (iso) setEndedAt(iso);
              }}
              className="max-w-xs"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>
              {t('symptoms.episode.didAnythingHelp', 'Did anything help?')}
            </Label>
            <TreatmentsEditor value={drafts} onChange={setDrafts} meds={meds} />
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={endEpisode.isPending}
              onClick={() =>
                endEpisode.mutate(
                  {
                    id: entry.id,
                    body: {
                      ended_at: endedAt,
                      treatments: draftsToInputs(drafts),
                    },
                  },
                  { onSuccess: () => setOpen(false) }
                )
              }
            >
              {t('symptoms.episode.end', 'End episode')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

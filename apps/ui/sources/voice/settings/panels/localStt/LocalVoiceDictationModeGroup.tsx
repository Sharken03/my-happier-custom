import * as React from 'react';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Switch } from '@/components/ui/forms/Switch';
import { t } from '@/text';

/**
 * Dictation mode for the local voice adapters. On, the microphone is one action per message: tap to
 * record, tap to send, and while a turn is running the composer's button stops that turn instead of
 * handing the slot to the microphone. Off, the microphone owns the empty composer the way upstream
 * does, and cancelling a pending voice turn stays on the voice surface.
 */
export function LocalVoiceDictationModeGroup(props: {
  dictationMode: boolean;
  setDictationMode: (next: boolean) => void;
}) {
  const { dictationMode, setDictationMode } = props;

  return (
    <ItemGroup
      title={t('settingsVoice.local.conversation.dictationMode.title')}
      footer={t('settingsVoice.local.conversation.dictationMode.footer')}
    >
      <Item
        title={t('settingsVoice.local.conversation.dictationMode.enableTitle')}
        subtitle={t('settingsVoice.local.conversation.dictationMode.enableSubtitle')}
        rightElement={
          <Switch value={dictationMode} onValueChange={(v) => setDictationMode(v)} />
        }
      />
    </ItemGroup>
  );
}

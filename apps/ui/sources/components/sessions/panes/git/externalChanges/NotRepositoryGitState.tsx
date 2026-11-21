import * as React from 'react';
import { ScrollView } from 'react-native';

import { NotSourceControlRepositoryState } from '@/components/sessions/sourceControl/states';
import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import { useDerivedSessionChangeSet } from '@/sync/domains/session/changes/hooks/useDerivedSessionChangeSet';

import { SessionExternalRepositoryChanges } from './SessionExternalRepositoryChanges';

/**
 * The git surface of a chat whose folder is not a repository. The files the chat changed in other
 * repositories ("Other repositories") still show, above the offer to initialize a repository.
 */
export function NotRepositoryGitState(props: Readonly<{
    sessionId: string;
    scmSnapshot: ScmWorkingSnapshot | null;
    canInitializeRepository: boolean;
    onInitialized?: () => void | Promise<void>;
}>): React.ReactElement {
    const { sessionChangeSet } = useDerivedSessionChangeSet(props.sessionId);
    const notRepositoryState = (
        <NotSourceControlRepositoryState
            sessionId={props.sessionId}
            canInitializeRepository={props.canInitializeRepository}
            onInitialized={props.onInitialized}
        />
    );
    if (!sessionChangeSet) return notRepositoryState;
    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
            <SessionExternalRepositoryChanges
                sessionId={props.sessionId}
                sessionChangeSet={sessionChangeSet}
                scmSnapshot={props.scmSnapshot}
            />
            {notRepositoryState}
        </ScrollView>
    );
}

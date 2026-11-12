/**
 * Holds an older-page apply while an Android fling runs.
 *
 * When content above the viewport grows, React Native's Android ScrollView keeps the
 * visible content in place and then re-creates the running fling
 * (`ReactScrollView.scrollToPreservingMomentum`). On device that re-created fling can
 * run against the user's direction, so the text jumps by up to a few hundred pixels.
 * A page that goes in while no fling runs does not do this. A drag stops the fling, so
 * the gate is open during a drag. iOS and web keep applying pages at once.
 */
export type NativeFlingState = Readonly<{
    momentumActive: boolean;
    dragActive: boolean;
}>;

export type NativeFlingApplyGate = Readonly<{
    /** Resolves when no fling runs. */
    waitForApply: () => Promise<void>;
    /** Call after the momentum or drag state changes. */
    notify: () => void;
    /** Lets every held page in, e.g. when the transcript unmounts or changes session. */
    releaseAll: () => void;
}>;

export function createNativeFlingApplyGate(params: Readonly<{
    platformOS: string;
    readFling: () => NativeFlingState;
}>): NativeFlingApplyGate {
    const waiters: Array<() => void> = [];
    const isHolding = (): boolean => {
        if (params.platformOS !== 'android') return false;
        const fling = params.readFling();
        return fling.momentumActive && !fling.dragActive;
    };
    const releaseAll = (): void => {
        for (const resolve of waiters.splice(0)) resolve();
    };
    return {
        waitForApply: () => {
            const holding = isHolding();
            console.log('HAPPIER_GATE', JSON.stringify({ step: 'wait', holding, fling: params.readFling() }));
            return holding ? new Promise<void>((resolve) => { waiters.push(resolve); }) : Promise.resolve();
        },
        notify: () => {
            console.log('HAPPIER_GATE', JSON.stringify({ step: 'notify', held: waiters.length, fling: params.readFling() }));
            if (!isHolding()) releaseAll();
        },
        releaseAll,
    };
}

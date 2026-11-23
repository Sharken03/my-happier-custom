import * as React from 'react';

export type CreateReactNavigationNativeMockOptions = Readonly<{
    isFocused?: boolean;
}>;

export function createReactNavigationNativeMock(options: CreateReactNavigationNativeMockOptions = {}) {
    const isFocused = options.isFocused ?? true;
    const navigation = { goBack: () => {} };

    return {
        CommonActions: {
            setParams: (params: Record<string, unknown>) => ({ type: 'SET_PARAMS', payload: { params } }),
        },
        // No navigator in tests: screens read no navigation object and no route.
        NavigationContext: React.createContext<unknown>(undefined),
        NavigationRouteContext: React.createContext<unknown>(undefined),
        useIsFocused: () => isFocused,
        useNavigation: () => navigation,
        useFocusEffect: (effect: () => void | (() => void)) => {
            React.useEffect(() => effect(), [effect]);
        },
    };
}

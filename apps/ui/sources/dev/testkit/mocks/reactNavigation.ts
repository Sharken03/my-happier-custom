import * as React from 'react';

export type CreateReactNavigationNativeMockOptions = Readonly<{
    isFocused?: boolean;
}>;

/**
 * The navigation contexts without a navigator: screens read no navigation object and no route.
 * For test files that write their own `@react-navigation/native` mock.
 */
export function createReactNavigationContextMocks() {
    return {
        NavigationContext: React.createContext<unknown>(undefined),
        NavigationRouteContext: React.createContext<unknown>(undefined),
    };
}

export function createReactNavigationNativeMock(options: CreateReactNavigationNativeMockOptions = {}) {
    const isFocused = options.isFocused ?? true;
    const navigation = { goBack: () => {} };

    return {
        CommonActions: {
            setParams: (params: Record<string, unknown>) => ({ type: 'SET_PARAMS', payload: { params } }),
        },
        ...createReactNavigationContextMocks(),
        useIsFocused: () => isFocused,
        useNavigation: () => navigation,
        useFocusEffect: (effect: () => void | (() => void)) => {
            React.useEffect(() => effect(), [effect]);
        },
    };
}

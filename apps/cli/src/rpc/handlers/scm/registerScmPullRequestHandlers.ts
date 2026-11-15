import type {
    ScmPullRequestCheckoutRequest,
    ScmPullRequestCheckoutResponse,
    ScmPullRequestCreateReviewRequest,
    ScmPullRequestCreateReviewResponse,
    ScmPullRequestGetRequest,
    ScmPullRequestGetResponse,
    ScmPullRequestListRequest,
    ScmPullRequestListResponse,
    ScmPullRequestOpenComposeRequest,
    ScmPullRequestOpenComposeResponse,
    ScmPullRequestOpenOrReuseRequest,
    ScmPullRequestOpenOrReuseResponse,
    ScmPullRequestPrepareWorktreeRequest,
    ScmPullRequestPrepareWorktreeResponse,
    ScmPullRequestRunStackedRequest,
    ScmPullRequestRunStackedResponse,
} from '@happier-dev/protocol';
import { SCM_OPERATION_ERROR_CODES } from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import { resolveCliFeatureDecision } from '@/features/featureDecisionService';
import { notRepositoryResponse, runScmRoute } from '@/scm/rpc/dispatch';

import type { ScmHandlerRouteBase, ScmMutatingRouteRunner } from './scmHandlerRouteBase';

export function registerScmPullRequestHandlers(
    rpcHandlerManager: RpcHandlerRegistrar,
    routeBase: ScmHandlerRouteBase,
    runMutatingRoute: ScmMutatingRouteRunner
): void {
    rpcHandlerManager.registerHandler<ScmPullRequestListRequest, ScmPullRequestListResponse>(
        RPC_METHODS.SCM_PULL_REQUEST_LIST,
        async (request) =>
            runScmRoute<ScmPullRequestListRequest, ScmPullRequestListResponse>({
                request,
                ...routeBase,
                onNonRepository: async () => notRepositoryResponse<ScmPullRequestListResponse>(),
                runWithBackend: ({ context, selection }) =>
                    selection.backend.pullRequests?.list({ context, request }) ?? Promise.resolve({
                        success: false,
                        errorCode: SCM_OPERATION_ERROR_CODES.FEATURE_UNSUPPORTED,
                        error: 'Pull request operations are not supported by the selected source-control backend.',
                    }),
            })
    );

    rpcHandlerManager.registerHandler<ScmPullRequestGetRequest, ScmPullRequestGetResponse>(
        RPC_METHODS.SCM_PULL_REQUEST_GET,
        async (request) =>
            runScmRoute<ScmPullRequestGetRequest, ScmPullRequestGetResponse>({
                request,
                ...routeBase,
                onNonRepository: async () => notRepositoryResponse<ScmPullRequestGetResponse>(),
                runWithBackend: ({ context, selection }) =>
                    selection.backend.pullRequests?.get({ context, request }) ?? Promise.resolve({
                        success: false,
                        errorCode: SCM_OPERATION_ERROR_CODES.FEATURE_UNSUPPORTED,
                        error: 'Pull request operations are not supported by the selected source-control backend.',
                    }),
            })
    );

    rpcHandlerManager.registerHandler<ScmPullRequestOpenComposeRequest, ScmPullRequestOpenComposeResponse>(
        RPC_METHODS.SCM_PULL_REQUEST_OPEN_COMPOSE,
        // Compose only describes the draft PR payload; opening/reusing the PR is the mutating route below.
        async (request) =>
            runScmRoute<ScmPullRequestOpenComposeRequest, ScmPullRequestOpenComposeResponse>({
                request,
                ...routeBase,
                onNonRepository: async () => notRepositoryResponse<ScmPullRequestOpenComposeResponse>(),
                runWithBackend: ({ context, selection }) =>
                    selection.backend.pullRequests?.openCompose({ context, request }) ?? Promise.resolve({
                        success: false,
                        errorCode: SCM_OPERATION_ERROR_CODES.FEATURE_UNSUPPORTED,
                        error: 'Pull request operations are not supported by the selected source-control backend.',
                    }),
            })
    );

    rpcHandlerManager.registerHandler<ScmPullRequestOpenOrReuseRequest, ScmPullRequestOpenOrReuseResponse>(
        RPC_METHODS.SCM_PULL_REQUEST_OPEN_OR_REUSE,
        async (request) =>
            runMutatingRoute(() =>
                runScmRoute<ScmPullRequestOpenOrReuseRequest, ScmPullRequestOpenOrReuseResponse>({
                    request,
                    ...routeBase,
                    onNonRepository: async () => notRepositoryResponse<ScmPullRequestOpenOrReuseResponse>(),
                    runWithBackend: ({ context, selection }) =>
                        selection.backend.pullRequests?.openOrReuse({ context, request }) ?? Promise.resolve({
                            success: false,
                            errorCode: SCM_OPERATION_ERROR_CODES.FEATURE_UNSUPPORTED,
                            error: 'Pull request operations are not supported by the selected source-control backend.',
                        }),
                })
            )
    );

    rpcHandlerManager.registerHandler<ScmPullRequestCheckoutRequest, ScmPullRequestCheckoutResponse>(
        RPC_METHODS.SCM_PULL_REQUEST_CHECKOUT,
        async (request) =>
            runMutatingRoute(() =>
                runScmRoute<ScmPullRequestCheckoutRequest, ScmPullRequestCheckoutResponse>({
                    request,
                    ...routeBase,
                    onNonRepository: async () => notRepositoryResponse<ScmPullRequestCheckoutResponse>(),
                    runWithBackend: ({ context, selection }) =>
                        selection.backend.pullRequests?.checkout({ context, request }) ?? Promise.resolve({
                            success: false,
                            errorCode: SCM_OPERATION_ERROR_CODES.FEATURE_UNSUPPORTED,
                            error: 'Pull request operations are not supported by the selected source-control backend.',
                        }),
                })
            )
    );

    rpcHandlerManager.registerHandler<ScmPullRequestPrepareWorktreeRequest, ScmPullRequestPrepareWorktreeResponse>(
        RPC_METHODS.SCM_PULL_REQUEST_PREPARE_WORKTREE,
        async (request) =>
            runMutatingRoute(() =>
                runScmRoute<ScmPullRequestPrepareWorktreeRequest, ScmPullRequestPrepareWorktreeResponse>({
                    request,
                    ...routeBase,
                    onNonRepository: async () => notRepositoryResponse<ScmPullRequestPrepareWorktreeResponse>(),
                    runWithBackend: ({ context, selection }) =>
                        selection.backend.pullRequests?.prepareWorktree({ context, request }) ?? Promise.resolve({
                            success: false,
                            errorCode: SCM_OPERATION_ERROR_CODES.FEATURE_UNSUPPORTED,
                            error: 'Pull request operations are not supported by the selected source-control backend.',
                        }),
                })
            )
    );

    rpcHandlerManager.registerHandler<ScmPullRequestRunStackedRequest, ScmPullRequestRunStackedResponse>(
        RPC_METHODS.SCM_PULL_REQUEST_RUN_STACKED,
        async (request) =>
            runMutatingRoute(() =>
                runScmRoute<ScmPullRequestRunStackedRequest, ScmPullRequestRunStackedResponse>({
                    request,
                    ...routeBase,
                    onNonRepository: async () => notRepositoryResponse<ScmPullRequestRunStackedResponse>(),
                    runWithBackend: ({ context, selection }) =>
                        selection.backend.pullRequests?.runStacked?.({ context, request }) ?? Promise.resolve({
                            success: false,
                            errorCode: SCM_OPERATION_ERROR_CODES.FEATURE_UNSUPPORTED,
                            error: 'Pull request stacked operations are not supported by the selected source-control backend.',
                            events: [],
                        }),
                })
            )
    );

    rpcHandlerManager.registerHandler<ScmPullRequestCreateReviewRequest, ScmPullRequestCreateReviewResponse>(
        RPC_METHODS.SCM_PULL_REQUEST_CREATE_REVIEW,
        async (request) => {
            // Creating a review is an outward write, so it is gated at the RPC boundary (not in the
            // operations layer) on the same source-control write feature the UI/CLI surfaces use.
            const writeOperationsDecision = resolveCliFeatureDecision({
                featureId: 'scm.writeOperations',
                env: process.env,
            });
            if (writeOperationsDecision.state !== 'enabled') {
                return {
                    success: false,
                    errorCode: SCM_OPERATION_ERROR_CODES.FEATURE_UNSUPPORTED,
                    error: 'Pull request review creation is not enabled.',
                };
            }
            return runMutatingRoute(() =>
                runScmRoute<ScmPullRequestCreateReviewRequest, ScmPullRequestCreateReviewResponse>({
                    request,
                    ...routeBase,
                    onNonRepository: async () => notRepositoryResponse<ScmPullRequestCreateReviewResponse>(),
                    runWithBackend: ({ context, selection }) =>
                        selection.backend.pullRequests?.createReview?.({ context, request }) ?? Promise.resolve({
                            success: false,
                            errorCode: SCM_OPERATION_ERROR_CODES.FEATURE_UNSUPPORTED,
                            error: 'Pull request review operations are not supported by the selected source-control backend.',
                        }),
                })
            );
        }
    );
}

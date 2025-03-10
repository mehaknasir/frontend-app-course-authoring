import { getAuthenticatedHttpClient } from '@edx/frontend-platform/auth';
import MockAdapter from 'axios-mock-adapter';
import { initializeMockApp } from '@edx/frontend-platform/testing';
import { history } from '@edx/frontend-platform';
import initializeStore from '../../../store';
import { getAppsUrl } from './api';
import {
  FAILED, SAVED, DENIED, selectApp, updateValidationStatus,
} from './slice';
import { fetchApps, saveAppConfig } from './thunks';
import { LOADED } from '../../../data/slice';
import { legacyApiResponse, piazzaApiResponse } from '../factories/mockApiResponses';

// Helper, that is used to forcibly finalize all promises
// in thunk before running matcher against state.
const executeThunk = async (thunk, dispatch, getState) => {
  await thunk(dispatch, getState);
  await new Promise(setImmediate);
};

const courseId = 'course-v1:edX+TestX+Test_Course';
const pagesAndResourcesPath = `/course/${courseId}/pages-and-resources`;
const featuresState = {
  'discussion-page': {
    id: 'discussion-page',
  },
  'embedded-course-sections': {
    id: 'embedded-course-sections',
  },
  'wcag-2.1': {
    id: 'wcag-2.1',
  },
  lti: {
    id: 'lti',
  },
};

const featureIds = [
  'discussion-page',
  'embedded-course-sections',
  'wcag-2.1',
  'lti',
];

const legacyApp = {
  id: 'legacy',
  featureIds: [
    'discussion-page',
    'embedded-course-sections',
    'wcag-2.1',
  ],
  documentationUrl: 'http://example.com',
  hasFullSupport: false,
};

const piazzaApp = {
  id: 'piazza',
  featureIds: [
    'discussion-page',
    'embedded-course-sections',
    'wcag-2.1',
    'lti',
  ],
  documentationUrl: 'http://example.com',
  hasFullSupport: true,
};

let axiosMock;
let store;

describe('Data layer integration tests', () => {
  beforeEach(() => {
    initializeMockApp({
      authenticatedUser: {
        userId: 3,
        username: 'abc123',
        administrator: true,
        roles: [],
      },
    });

    axiosMock = new MockAdapter(getAuthenticatedHttpClient());

    store = initializeStore();
  });

  afterEach(() => {
    axiosMock.reset();
  });

  describe('fetchApps', () => {
    test('network error', async () => {
      axiosMock.onGet(getAppsUrl(courseId)).networkError();

      await executeThunk(fetchApps(courseId), store.dispatch);

      expect(store.getState().discussions).toEqual(
        expect.objectContaining({
          appIds: [],
          featureIds: [],
          activeAppId: null,
          selectedAppId: null,
          status: FAILED,
          saveStatus: SAVED,
          hasValidationError: false,
        }),
      );
    });

    test('permission denied error', async () => {
      axiosMock.onGet(getAppsUrl(courseId)).reply(403);

      await executeThunk(fetchApps(courseId), store.dispatch);

      expect(store.getState().discussions).toEqual(
        expect.objectContaining({
          appIds: [],
          featureIds: [],
          activeAppId: null,
          selectedAppId: null,
          status: DENIED,
          saveStatus: SAVED,
          hasValidationError: false,
        }),
      );
    });

    test('successfully loads an LTI configuration', async () => {
      axiosMock.onGet(getAppsUrl(courseId)).reply(200, piazzaApiResponse);

      await executeThunk(fetchApps(courseId), store.dispatch);

      expect(store.getState().discussions).toEqual({
        appIds: ['legacy', 'piazza'],
        featureIds,
        activeAppId: 'piazza',
        selectedAppId: null,
        status: LOADED,
        saveStatus: SAVED,
        hasValidationError: false,
      });
      expect(store.getState().models.apps.legacy).toEqual(legacyApp);
      expect(store.getState().models.apps.piazza).toEqual(piazzaApp);
      expect(store.getState().models.features).toEqual(featuresState);
      expect(store.getState().models.appConfigs.piazza).toEqual({
        id: 'piazza',
        consumerKey: 'client_key_123',
        consumerSecret: 'client_secret_123',
        launchUrl: 'https://localhost/example',
      });
    });

    test('successfully loads a Legacy configuration', async () => {
      axiosMock.onGet(getAppsUrl(courseId)).reply(200, legacyApiResponse);

      await executeThunk(fetchApps(courseId), store.dispatch);

      expect(store.getState().discussions).toEqual({
        appIds: ['legacy', 'piazza'],
        featureIds,
        activeAppId: 'legacy',
        selectedAppId: null,
        status: LOADED,
        saveStatus: SAVED,
        hasValidationError: false,
      });
      expect(store.getState().models.apps.legacy).toEqual(legacyApp);
      expect(store.getState().models.apps.piazza).toEqual(piazzaApp);
      expect(store.getState().models.features).toEqual(featuresState);
      expect(store.getState().models.appConfigs.legacy).toEqual({
        id: 'legacy',
        allowAnonymousPosts: false,
        allowAnonymousPostsPeers: false,
        blackoutDates: '[]',
        // TODO: Note!  As of this writing, all the data below this line is NOT returned in the API
        // but we add it in during normalization.
        divideByCohorts: false,
        allowDivisionByUnit: false,
        divideCourseWideTopics: false,
        divideGeneralTopic: false,
        divideQuestionsForTAsTopic: false,
      });
    });
  });

  describe('selectApp', () => {
    test('sets selectedAppId', () => {
      const appId = 'piazza';
      store.dispatch(selectApp({ appId }));

      expect(store.getState().discussions.selectedAppId).toEqual(appId);
    });
  });

  describe('updateValidationStatus', () => {
    test.each([true, false])('sets hasValidationError value to %s ', (hasError) => {
      store.dispatch(updateValidationStatus({ hasError }));

      expect(store.getState().discussions.hasValidationError).toEqual(hasError);
    });
  });

  describe('saveAppConfig', () => {
    test('network error', async () => {
      history.push(`/course/${courseId}/pages-and-resources/discussions/configure/piazza`);

      axiosMock.onGet(getAppsUrl(courseId)).reply(200, piazzaApiResponse);
      axiosMock.onPost(getAppsUrl(courseId)).networkError();

      // We call fetchApps and selectApp here too just to get us into a real state.
      await executeThunk(fetchApps(courseId), store.dispatch);
      store.dispatch(selectApp({ appId: 'piazza' }));
      await executeThunk(saveAppConfig(courseId, 'piazza', {}, pagesAndResourcesPath), store.dispatch);

      // Assert we're still on the form.
      expect(window.location.pathname).toEqual(`/course/${courseId}/pages-and-resources/discussions/configure/piazza`);
      expect(store.getState().discussions).toEqual(
        expect.objectContaining({
          appIds: ['legacy', 'piazza'],
          featureIds,
          activeAppId: 'piazza',
          selectedAppId: 'piazza',
          status: LOADED,
          saveStatus: FAILED,
          hasValidationError: false,
        }),
      );
    });

    test('permission denied error', async () => {
      history.push(`/course/${courseId}/pages-and-resources/discussions/configure/piazza`);

      axiosMock.onGet(getAppsUrl(courseId)).reply(200, piazzaApiResponse);
      axiosMock.onPost(getAppsUrl(courseId)).reply(403);

      // We call fetchApps and selectApp here too just to get us into a real state.
      await executeThunk(fetchApps(courseId), store.dispatch);
      store.dispatch(selectApp({ appId: 'piazza' }));
      await executeThunk(saveAppConfig(courseId, 'piazza', {}, pagesAndResourcesPath), store.dispatch);

      // Assert we're still on the form.
      expect(window.location.pathname).toEqual(`/course/${courseId}/pages-and-resources/discussions/configure/piazza`);
      expect(store.getState().discussions).toEqual(
        expect.objectContaining({
          appIds: ['legacy', 'piazza'],
          featureIds,
          activeAppId: 'piazza',
          selectedAppId: 'piazza',
          status: DENIED, // We set BOTH statuses to DENIED for saveAppConfig - this removes the UI.
          saveStatus: DENIED,
          hasValidationError: false,
        }),
      );
    });

    test('successfully saves an LTI configuration', async () => {
      history.push(`/course/${courseId}/pages-and-resources/discussions/configure/piazza`);

      axiosMock.onGet(getAppsUrl(courseId)).reply(200, piazzaApiResponse);
      axiosMock.onPost(getAppsUrl(courseId), {
        context_key: courseId,
        enabled: true,
        lti_configuration: {
          lti_1p1_client_key: 'new_consumer_key',
          lti_1p1_client_secret: 'new_consumer_secret',
          lti_1p1_launch_url: 'http://localhost/new_launch_url',
          version: 'lti_1p1',
        },
        plugin_configuration: {},
        provider_type: 'piazza',
      }).reply(200, {
        ...piazzaApiResponse, // This uses the existing configuration but with a replacement
        // lti_configuration that matches what we tried to save.
        lti_configuration: {
          lti_1p1_client_key: 'new_consumer_key',
          lti_1p1_client_secret: 'new_consumer_secret',
          lti_1p1_launch_url: 'https://localhost/new_launch_url',
          version: 'lti_1p1',
        },
      });

      // We call fetchApps and selectApp here too just to get us into a real state.
      await executeThunk(fetchApps(courseId), store.dispatch);
      store.dispatch(selectApp({ appId: 'piazza' }));
      await executeThunk(saveAppConfig(
        courseId,
        'piazza',
        {
          consumerKey: 'new_consumer_key',
          consumerSecret: 'new_consumer_secret',
          launchUrl: 'http://localhost/new_launch_url',
        },
        pagesAndResourcesPath,
      ), store.dispatch);

      expect(window.location.pathname).toEqual(pagesAndResourcesPath);
      expect(store.getState().discussions).toEqual(
        expect.objectContaining({
          appIds: ['legacy', 'piazza'],
          featureIds,
          activeAppId: 'piazza',
          selectedAppId: 'piazza',
          status: LOADED,
          saveStatus: SAVED,
          hasValidationError: false,
        }),
      );
      expect(store.getState().models.appConfigs.piazza).toEqual({
        id: 'piazza',
        consumerKey: 'new_consumer_key',
        consumerSecret: 'new_consumer_secret',
        launchUrl: 'https://localhost/new_launch_url',
      });
    });

    test('successfully saves a Legacy configuration', async () => {
      history.push(`/course/${courseId}/pages-and-resources/discussions/configure/legacy`);

      axiosMock.onGet(getAppsUrl(courseId)).reply(200, legacyApiResponse);
      axiosMock.onPost(getAppsUrl(courseId), {
        context_key: courseId,
        enabled: true,
        lti_configuration: {},
        plugin_configuration: {
          allow_anonymous: true,
          allow_anonymous_to_peers: true,
          discussion_blackouts: [['2015-09-15', '2015-09-21'], ['2015-10-01', '2015-10-08']],
        },
        provider_type: 'legacy',
      }).reply(200, {
        ...legacyApiResponse, // This uses the existing configuration but with a replacement
        // plugin_configuration that matches what we tried to save.
        plugin_configuration: {
          allow_anonymous: true,
          allow_anonymous_to_peers: true,
          discussion_blackouts: [['2015-09-15', '2015-09-21'], ['2015-10-01', '2015-10-08']],
        },
      });

      // We call fetchApps and selectApp here too just to get us into a real state.
      await executeThunk(fetchApps(courseId), store.dispatch);
      store.dispatch(selectApp({ appId: 'legacy' }));
      await executeThunk(saveAppConfig(
        courseId,
        'legacy',
        {
          allowAnonymousPosts: true,
          allowAnonymousPostsPeers: true,
          blackoutDates: '[["2015-09-15","2015-09-21"],["2015-10-01","2015-10-08"]]',
          // TODO: Note!  As of this writing, all the data below this line is NOT returned in the API
          // but we technically send it to the thunk, so here it is.
          divideByCohorts: true,
          allowDivisionByUnit: true,
          divideCourseWideTopics: true,
          divideGeneralTopic: true,
          divideQuestionsForTAsTopic: true,
        },
        pagesAndResourcesPath,
      ), store.dispatch);

      expect(window.location.pathname).toEqual(pagesAndResourcesPath);
      expect(store.getState().discussions).toEqual(
        expect.objectContaining({
          appIds: ['legacy', 'piazza'],
          featureIds,
          activeAppId: 'legacy',
          selectedAppId: 'legacy',
          status: LOADED,
          saveStatus: SAVED,
          hasValidationError: false,
        }),
      );
      expect(store.getState().models.appConfigs.legacy).toEqual({
        id: 'legacy',
        // These three fields should be updated.
        allowAnonymousPosts: true,
        allowAnonymousPostsPeers: true,
        blackoutDates: '[["2015-09-15","2015-09-21"],["2015-10-01","2015-10-08"]]',
        // TODO: Note!  The values we tried to save were ignored, this test reflects what currently
        // happens, but NOT what we want to have happen!
        divideByCohorts: false,
        allowDivisionByUnit: false,
        divideCourseWideTopics: false,
        divideGeneralTopic: false,
        divideQuestionsForTAsTopic: false,
      });
    });
  });
});

import nock from "nock";

const OV_BASE = "http://openviking-mock.test";

// Stub all OpenViking API calls used by Alice nodes

export const mockOpenVikingAll = (): void => {
  // listSessions → return empty (trigger createSession)
  nock(OV_BASE)
    .get("/api/v1/sessions")
    .reply(200, { result: { sessions: [] } })
    .persist();

  // createSession → return new session
  nock(OV_BASE)
    .post("/api/v1/sessions")
    .reply(200, { result: { session_id: "ov_sess_test_001" } })
    .persist();

  // findMemories → return empty results
  nock(OV_BASE)
    .post("/api/v1/search/find")
    .reply(200, { result: { memories: [], resources: [], skills: [], total: 0 } })
    .persist();

  // search endpoint
  nock(OV_BASE)
    .post("/api/v1/search/search")
    .reply(200, { result: { memories: [], resources: [], skills: [], total: 0 } })
    .persist();

  // session used endpoint
  nock(OV_BASE)
    .post(/\/api\/v1\/sessions\/.*\/used/)
    .reply(200, { result: { ok: true } })
    .persist();

  // addMessage (persist user/assistant messages)
  nock(OV_BASE)
    .post(/\/api\/v1\/sessions\/.*\/messages/)
    .reply(200, { result: { ok: true } })
    .persist();

  // commitSession
  nock(OV_BASE)
    .post(/\/api\/v1\/sessions\/.*\/commit/)
    .reply(200, { result: { ok: true } })
    .persist();
};

export const mockOpenVikingSessionWithExisting = (sessionId: string): void => {
  nock(OV_BASE)
    .get("/api/v1/sessions")
    .reply(200, {
      result: {
        sessions: [{
          session_id: sessionId,
          status: "active",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          message_count: 2
        }]
      }
    })
    .persist();

  nock(OV_BASE)
    .post("/api/v1/search/find")
    .reply(200, { result: { memories: [], resources: [], skills: [], total: 0 } })
    .persist();

  // search endpoint
  nock(OV_BASE)
    .post("/api/v1/search/search")
    .reply(200, { result: { memories: [], resources: [], skills: [], total: 0 } })
    .persist();

  // session used endpoint
  nock(OV_BASE)
    .post(/\/api\/v1\/sessions\/.*\/used/)
    .reply(200, { result: { ok: true } })
    .persist();

  nock(OV_BASE)
    .post(/\/api\/v1\/sessions\/.*\/messages/)
    .reply(200, { result: { ok: true } })
    .persist();
};

export const cleanNock = (): void => {
  nock.cleanAll();
};

import nock from "nock";

const OV_BASE = "http://openviking-mock.test";

// Stub all OpenViking API calls used by Alice nodes

export const mockOpenVikingAll = (): void => {
  // listSessions → return empty (trigger createSession)
  nock(OV_BASE)
    .get("/api/v1/sessions")
    .reply(200, { status: "ok", result: { sessions: [] } })
    .persist();

  // createSession → return new session
  nock(OV_BASE)
    .post("/api/v1/sessions")
    .reply(200, { status: "ok", result: { session_id: "ov_sess_test_001" } })
    .persist();

  // findMemories → return empty results
  nock(OV_BASE)
    .post("/api/v1/search/find")
    .reply(200, { status: "ok", result: { memories: [], resources: [], skills: [], total: 0 } })
    .persist();

  // search endpoint
  nock(OV_BASE)
    .post("/api/v1/search/search")
    .reply(200, { status: "ok", result: { memories: [], resources: [], skills: [], total: 0 } })
    .persist();

  // session used endpoint
  nock(OV_BASE)
    .post(/\/api\/v1\/sessions\/.*\/used/)
    .reply(200, { status: "ok", result: { ok: true } })
    .persist();

  // addMessage (persist user/assistant messages)
  nock(OV_BASE)
    .post(/\/api\/v1\/sessions\/.*\/messages/)
    .reply(200, { status: "ok", result: { ok: true } })
    .persist();

  // commitSession
  nock(OV_BASE)
    .post(/\/api\/v1\/sessions\/.*\/commit/)
    .reply(200, { status: "ok", result: { ok: true } })
    .persist();

  // content/overview (L1 overview for viking:// URI)
  nock(OV_BASE)
    .get("/api/v1/content/overview")
    .query(true)
    .reply(200, { status: "ok", result: { abstract: "mock overview", uri: "" } })
    .persist();

  // content/read (L2 full detail for viking:// URI)
  nock(OV_BASE)
    .get("/api/v1/content/read")
    .query(true)
    .reply(200, { status: "ok", result: { content: "mock content", uri: "" } })
    .persist();
};

export const mockOpenVikingSessionWithExisting = (sessionId: string): void => {
  nock(OV_BASE)
    .get("/api/v1/sessions")
    .reply(200, {
      status: "ok",
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
    .reply(200, { status: "ok", result: { memories: [], resources: [], skills: [], total: 0 } })
    .persist();

  // search endpoint
  nock(OV_BASE)
    .post("/api/v1/search/search")
    .reply(200, { status: "ok", result: { memories: [], resources: [], skills: [], total: 0 } })
    .persist();

  // session used endpoint
  nock(OV_BASE)
    .post(/\/api\/v1\/sessions\/.*\/used/)
    .reply(200, { status: "ok", result: { ok: true } })
    .persist();

  nock(OV_BASE)
    .post(/\/api\/v1\/sessions\/.*\/messages/)
    .reply(200, { status: "ok", result: { ok: true } })
    .persist();

  // commitSession (for existing session)
  nock(OV_BASE)
    .post(/\/api\/v1\/sessions\/.*\/commit/)
    .reply(200, { status: "ok", result: { ok: true } })
    .persist();

  // content endpoints
  nock(OV_BASE)
    .get("/api/v1/content/overview")
    .query(true)
    .reply(200, { status: "ok", result: { abstract: "mock overview", uri: "" } })
    .persist();

  nock(OV_BASE)
    .get("/api/v1/content/read")
    .query(true)
    .reply(200, { status: "ok", result: { content: "mock content", uri: "" } })
    .persist();
};

export const cleanNock = (): void => {
  nock.cleanAll();
};

import nock from 'nock';

// Disable real network connections by default
nock.disableNetConnect();

// Don't clean all mocks automatically after each test - let tests manage their own mocks
beforeEach(() => {
  // Enable nock mocking for each test
  if (!nock.isActive()) {
    nock.activate();
  }
});

afterEach(() => {
  // Clean up any pending mocks after each test
  nock.cleanAll();
});

afterAll(() => {
  // Re-enable network connections after all tests
  nock.enableNetConnect();
  nock.restore();
});

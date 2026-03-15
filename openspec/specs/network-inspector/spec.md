## Purpose
Defines the OkHttp network traffic interception system: parsing OkHttp log lines from logcat using TID-keyed state machines, displaying transactions in the Network sidebar panel, and providing full transaction detail on demand.

## Requirements

### Requirement: OkHttp traffic interception from logcat
The system SHALL intercept OkHttp HTTP transactions from logcat lines tagged with `okhttp.OkHttpClient:` without requiring any instrumentation code changes in the Android app.

#### Scenario: OkHttp lines forwarded during active logcat stream
- **WHEN** logcat produces lines containing `"okhttp.OkHttpClient:"`
- **THEN** the system SHALL forward those lines to the OkHttp parser

#### Scenario: Non-OkHttp lines ignored by parser
- **WHEN** a logcat line does not contain `"okhttp.OkHttpClient:"`
- **THEN** the parser SHALL ignore the line

### Requirement: TID-keyed request/response correlation
The system SHALL correlate HTTP request and response log lines using the thread ID (TID) from logcat as a correlation key.

#### Scenario: Request and response matched by TID
- **WHEN** a request log line and its corresponding response lines share the same TID
- **THEN** the system SHALL assemble them into a single `HttpTransaction` object

#### Scenario: Concurrent requests on different threads
- **WHEN** multiple HTTP requests are in-flight simultaneously on different threads
- **THEN** the system SHALL maintain separate state machines per TID without cross-contamination

### Requirement: HTTP transaction state machine
The system SHALL parse OkHttp log lines using a per-TID state machine progressing through: `request` → `response_headers` → `response_body`.

#### Scenario: Request line initiates transaction
- **WHEN** a TID-keyed line matches the request start pattern
- **THEN** the system SHALL create a new in-flight `HttpTransaction` for that TID in `request` state

#### Scenario: Transaction completed on END HTTP marker
- **WHEN** the parser encounters `<-- END HTTP` for a TID
- **THEN** the system SHALL finalize the `HttpTransaction` and emit it via the `onComplete` callback

#### Scenario: Transaction completed on HTTP FAILED marker
- **WHEN** the parser encounters `<-- HTTP FAILED:` for a TID
- **THEN** the system SHALL mark the transaction as failed and emit it via the `onComplete` callback

### Requirement: Network panel transaction display
The system SHALL display completed HTTP transactions in the Network sidebar panel, newest-first, capped at 100 items.

#### Scenario: New transaction added to panel
- **WHEN** a new `HttpTransaction` is completed by the parser
- **THEN** the system SHALL prepend it to the Network tree view and refresh the panel immediately

#### Scenario: Panel capped at 100 transactions
- **WHEN** the number of stored transactions exceeds 100
- **THEN** the system SHALL discard the oldest entries to maintain a maximum of 100 items

### Requirement: Transaction tree item appearance
The system SHALL display each transaction with method, path, status code, duration, and a color-coded status icon.

#### Scenario: Successful transaction display
- **WHEN** a transaction with a 2xx status code is shown
- **THEN** the tree item SHALL use a green status icon

#### Scenario: Client error transaction display
- **WHEN** a transaction with a 4xx status code is shown
- **THEN** the tree item SHALL use an orange status icon

#### Scenario: Server error transaction display
- **WHEN** a transaction with a 5xx status code or network error is shown
- **THEN** the tree item SHALL use a red status icon

#### Scenario: In-flight transaction display
- **WHEN** a transaction has not yet received a response
- **THEN** the tree item SHALL use a spinner/loading icon

### Requirement: Full transaction detail on selection
The system SHALL print the full request/response details to the Android Network output channel when the user selects a transaction in the Network panel.

#### Scenario: Transaction details printed on selection
- **WHEN** the user clicks a transaction item in the Network panel
- **THEN** the system SHALL print request headers, response headers, and the response body to the Android Network output channel with JSON bodies pretty-printed

### Requirement: Network log clear
The system SHALL provide a Clear Network Log action that resets the panel, the parser state, and the output channel.

#### Scenario: Network log cleared
- **WHEN** the user invokes `Android: Clear Network Log`
- **THEN** the system SHALL empty the transaction list, reset the OkHttp parser state, and clear the Android Network output channel

### Requirement: Parser reset on new run
The system SHALL reset the OkHttp parser state when a new run session begins to prevent stale in-flight transactions from a previous session.

#### Scenario: Parser reset on run start
- **WHEN** a new run & stream logs session starts
- **THEN** the system SHALL call `parser.reset()` to clear all pending TID state

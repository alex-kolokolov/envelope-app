# Plan: WebSocket Status Handling and API Integration

**Goal:** Modify the `useWebSocketGame` hook to parse specific WebSocket message formats and expose relevant game state information (like status, theme text, and flags for results/stats) to the consuming React components. The components will then use this state to manage UI, timers, and trigger the appropriate REST API calls.

**Phase 1: Enhance `useWebSocketGame` Hook**

1.  **Define New State Variables:**
    - Add state variables within the hook to store:
      - `gameStatus`: A string representing the parsed status (e.g., `"WAITING_FOR_PLAYERS"`, `"MAIN_PLAYER_THINKING"`, `"THEME_INPUT"`, `"SCENARIO_PRESENTED"`, `"WAITING_FOR_GPT"`, `"RESULTS_READY"`, `"STATS_READY"`, `"CLOSED"`).
      - `currentTheme`: A string to store the theme/scenario text when received.
      - Potentially other flags or data extracted from messages if needed.
2.  **Update `onmessage` Handler:**
    - Implement robust parsing logic (likely using regex or string methods) within the `onmessage` callback to handle the different message formats:
      - `[SYSTEM]: Статус — {STATUS_NAME}`: Extract `{STATUS_NAME}` and update `gameStatus`.
      - `[SYSTEM]: Главный игрок вводит тему`: Set `gameStatus` to `"THEME_INPUT"`.
      - `[SYSTEM]: Ситуация: {THEME_TEXT}`: Extract `{THEME_TEXT}`, update `currentTheme`, and set `gameStatus` to `"SCENARIO_PRESENTED"`.
      - `[RESULT]: ...`: Set `gameStatus` to `"RESULTS_READY"`. (The actual result data will be fetched via REST).
      - `[ALL_STATS]: ...`: Set `gameStatus` to `"STATS_READY"`. (The actual stats data will be fetched via REST).
      - Handle potential `WAITING_FOR_ALL_ANSWERS_FROM_GPT` status if the backend sends it explicitly, setting `gameStatus` to `"WAITING_FOR_GPT"`.
      - Handle other potential system messages or error messages.
    - Log unparsed or unexpected messages for debugging.
3.  **Return Enhanced State:**
    - Modify the hook's return object to include the new state variables (`gameStatus`, `currentTheme`, etc.) alongside the existing ones (`isConnected`, `lastMessage`, `error`, `sendMessage`, `readyState`).

**Phase 2: Component Implementation (Responsibility of `code` mode)**

- **Consume Hook State:** Components (like lobby, game screens) will use the enhanced `useWebSocketGame` hook and react to changes in `gameStatus`, `currentTheme`, etc.
- **Conditional UI Rendering:** Display different UI elements (buttons, input fields, waiting messages, timers, results, stats) based on the `gameStatus` and whether the user is an admin.
- **Timer Logic:** Implement client-side timers as described:
  - Admin theme input timer.
  - Player answer input timer.
  - 180-second wait timer during `WAITING_FOR_GPT` status (if applicable).
- **API Calls:** Trigger REST API calls using the existing client (`lib/api/client.ts`) based on UI interactions or state changes:
  - `POST /games/forceStart` (Admin action).
  - `GET /room/{roomId}/answers` (When `gameStatus` becomes `"RESULTS_READY"`).
  - `GET /room/{roomId}/stats` (When `gameStatus` becomes `"STATS_READY"`).
- **WebSocket Sending:** Use the `sendMessage` function from the hook to send admin-provided themes or player answers to the server.
- **Disconnection/Closing Logic:** Handle game closing or user disconnection based on button clicks (e.g., non-admin "Back" button) or timer expirations.

**Mermaid Diagram of Planned Flow:**

```mermaid
sequenceDiagram
    participant WS as WebSocket Server
    participant Hook as useWebSocketGame
    participant Comp as Component (UI)
    participant API as REST API

    WS->>Hook: Sends message (e.g., "[SYSTEM]: Статус — MAIN_PLAYER_THINKING")
    Hook->>Hook: Parses message, extracts status
    Hook->>Comp: Updates state (gameStatus = "MAIN_PLAYER_THINKING")
    Comp->>Comp: Renders UI based on status & admin role (e.g., shows "Start Game" button for admin)
    alt Admin Clicks Start
        Comp->>API: POST /games/forceStart(roomId)
        API-->>Comp: Response
    end
    alt Non-Admin Clicks Back
        Comp->>Hook: Close connection logic
        Hook->>WS: Close WebSocket
    end


    WS->>Hook: Sends message (e.g., "[SYSTEM]: Главный игрок вводит тему")
    Hook->>Hook: Parses message
    Hook->>Comp: Updates state (gameStatus = "THEME_INPUT")
    Comp->>Comp: Renders UI (Admin: input + timer; Non-admin: waiting)
    alt Admin Submits Theme
        Comp->>Hook: sendMessage("User theme text")
        Hook->>WS: Sends theme text
    else Timer Expires (Admin)
        Comp->>Hook: Close connection logic
        Hook->>WS: Close WebSocket
    end

    WS->>Hook: Sends message (e.g., "[SYSTEM]: Ситуация: Meteor")
    Hook->>Hook: Parses message, extracts theme
    Hook->>Comp: Updates state (gameStatus = "SCENARIO_PRESENTED", currentTheme = "Meteor")
    Comp->>Comp: Renders UI (Show theme + answer input + timer)
    alt Player Submits Answer
        Comp->>Hook: sendMessage("Player answer text")
        Hook->>WS: Sends answer text
    else Timer Expires (Player)
        Comp->>Hook: Close connection logic
        Hook->>WS: Close WebSocket
    end

    WS->>Hook: Sends message (e.g., "[RESULT]: ...")
    Hook->>Hook: Parses message
    Hook->>Comp: Updates state (gameStatus = "RESULTS_READY")
    Comp->>API: GET /room/{roomId}/answers
    API-->>Comp: Round results
    Comp->>Comp: Renders round results

    WS->>Hook: Sends message (e.g., "[ALL_STATS]: ...")
    Hook->>Hook: Parses message
    Hook->>Comp: Updates state (gameStatus = "STATS_READY")
    Comp->>API: GET /room/{roomId}/stats
    API-->>Comp: Final stats
    Comp->>Comp: Renders final stats

    Note over Comp: Component also handles 180s timeout\n during WAITING_FOR_GPT status (if applicable)\n and triggers disconnection.
```

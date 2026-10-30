from __future__ import annotations

import unittest
from typing import Any

from support import connect, error_of

from example_team import EXAMPLE_TEAM, create_args, example_team, minimal_team
from intake_team_sdk import CREATE_TASK_TOOL, GET_TASK_STATUS_TOOL


class TaskStatusTest(unittest.IsolatedAsyncioTestCase):
    async def test_reports_known_tasks_and_leaves_out_the_rest(self) -> None:
        async with connect(example_team()) as client:
            await client.call_tool(CREATE_TASK_TOOL, create_args())
            result = await client.call_tool(
                GET_TASK_STATUS_TOOL, {"taskIds": ["task-1", "unknown"]}
            )

        self.assertEqual(
            result.structuredContent,
            {
                "statuses": [
                    {
                        "taskId": "task-1",
                        "category": "todo",
                        "label": "Open",
                        "assignee": None,
                        "lastChangedAt": None,
                    }
                ]
            },
        )

    async def test_drops_unasked_and_malformed_statuses(self) -> None:
        def status(**overrides: Any) -> dict[str, Any]:
            entry: dict[str, Any] = {
                "taskId": "mine",
                "category": "done",
                "label": "Done",
                "assignee": None,
                "lastChangedAt": None,
            }
            entry.update(overrides)

            return entry

        async def get_task_status(_ids: Any, _context: Any) -> Any:
            return {
                "statuses": [
                    status(taskId="other"),
                    status(category="archived"),
                    status(label="  "),
                    status(assignee=7),
                    {key: value for key, value in status().items() if key != "lastChangedAt"},
                    "not a status",
                    status(assignee="Ada"),
                ]
            }

        async with connect(minimal_team(get_task_status=get_task_status)) as client:
            result = await client.call_tool(GET_TASK_STATUS_TOOL, {"taskIds": ["mine"]})

        self.assertEqual(result.structuredContent, {"statuses": [status(assignee="Ada")]})

    async def test_refuses_a_malformed_id_list(self) -> None:
        async with connect(EXAMPLE_TEAM) as client:
            for args in [
                {"taskIds": []},
                {},
                {"taskIds": "task-1"},
                {"taskIds": [""]},
                {"taskIds": [7]},
                {"taskIds": ["t"] * 51},
                {"taskIds": ["t" * 257]},
            ]:
                with self.subTest(args=str(args)[:40]):
                    result = await client.call_tool(GET_TASK_STATUS_TOOL, args)

                    self.assertEqual(
                        error_of(result),
                        {
                            "code": "INVALID_INPUT",
                            "message": "taskIds must list 1 to 50 task ids",
                            "retryable": False,
                        },
                    )

    async def test_treats_status_as_unknown_for_a_team_without_it(self) -> None:
        async with connect(minimal_team()) as client:
            result = await client.call_tool(GET_TASK_STATUS_TOOL, {"taskIds": ["task-1"]})

        self.assertEqual(
            error_of(result),
            {
                "code": "INVALID_INPUT",
                "message": "Unknown tool: intake_get_task_status",
                "retryable": False,
            },
        )


if __name__ == "__main__":
    unittest.main()

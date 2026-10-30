"""
A team's output held to the output schemas `tools/list` publishes.

`jsonschema` is what the MCP client validates `structuredContent` with, so the
output is judged here as the host's client will judge it, and what that client
would reject never leaves.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from jsonschema.exceptions import best_match  # type: ignore[import-untyped]
from jsonschema.validators import validator_for  # type: ignore[import-untyped]

from ._generated import TOOL_CONTRACTS
from .contract import CREATE_TASK_TOOL, GET_TASK_STATUS_TOOL


def _validator(schema: dict[str, Any]) -> Any:
    return validator_for(schema)(schema)


_OUTPUT_VALIDATORS = {tool["name"]: _validator(tool["outputSchema"]) for tool in TOOL_CONTRACTS}


def assert_contract_output(tool: str, payload: Any) -> None:
    """
    Raises `ValueError` if `payload` is not what the contract tool's output
    schema allows; the message says where, never with the value itself.
    """
    validator = _OUTPUT_VALIDATORS.get(tool)
    error = None if validator is None else best_match(validator.iter_errors(payload))

    if error is not None:
        raise ValueError(
            f"The {tool} result does not match its output schema: "
            f"{error.json_path} fails {error.validator}"
        )


def _definition_check(tool: str, definition: str) -> Callable[[Any], bool]:
    contract = next(candidate for candidate in TOOL_CONTRACTS if candidate["name"] == tool)
    validator = _validator(
        {
            "$ref": f"#/definitions/{definition}",
            "definitions": contract["outputSchema"]["definitions"],
        }
    )

    def check(value: Any) -> bool:
        valid: bool = validator.is_valid(value)

        return valid

    return check


is_task_reference = _definition_check(CREATE_TASK_TOOL, "TaskReference")
"""One task reference as `intake_create_task`'s output schema defines it."""

is_task_status = _definition_check(GET_TASK_STATUS_TOOL, "TaskStatus")
"""One status as `intake_get_task_status`'s output schema defines it."""

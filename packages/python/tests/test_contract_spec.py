"""
`spec/` is the contract; these check that the shared fixtures mean what they
say under Python's validator too, and that the generated module agrees with
`spec/`. The JavaScript suite runs the same fixtures, so a case judged
differently here fails one side or the other.
"""

from __future__ import annotations

import unittest
from typing import Any

from support import read_spec

from jsonschema import Draft7Validator

from intake_team_sdk import (
    CONTRACT_TOOL_NAMES,
    CONTRACT_TOOL_PREFIX,
    CREATE_SCOPE,
    INTAKE_CONTRACT_VERSION,
    READ_SCOPE,
    TOOL_CONTRACTS,
)
from intake_team_sdk._generated import SERVICE_TOKEN_RULES

SCHEMA = read_spec("intake-contract.schema.json")
CONTRACT = read_spec("contract.json")
CASES = read_spec("fixtures/contract-cases.json")["cases"]


def validator_for(definition: str) -> Draft7Validator:
    """One definition, resolved against the whole schema document."""
    return Draft7Validator({**SCHEMA, "$ref": f"#/definitions/{definition}"})


def refs_in(node: Any) -> list[str]:
    if isinstance(node, dict):
        own = [node["$ref"]] if isinstance(node.get("$ref"), str) else []

        return own + [ref for value in node.values() for ref in refs_in(value)]

    if isinstance(node, list):
        return [ref for value in node for ref in refs_in(value)]

    return []


class SchemaFixturesTest(unittest.TestCase):
    def test_the_schema_is_valid_draft_7(self) -> None:
        Draft7Validator.check_schema(SCHEMA)

    def test_every_case_is_judged_as_the_fixture_says(self) -> None:
        self.assertGreater(len(CASES), 0)

        for case in CASES:
            with self.subTest(case["name"]):
                self.assertIn(case["definition"], SCHEMA["definitions"])

                errors = list(validator_for(case["definition"]).iter_errors(case["value"]))

                self.assertEqual(
                    len(errors) == 0, case["valid"], [error.message for error in errors]
                )


class GeneratedContractTest(unittest.TestCase):
    def test_tool_contracts_cover_exactly_the_contract_tool_names(self) -> None:
        self.assertEqual([tool["name"] for tool in TOOL_CONTRACTS], list(CONTRACT_TOOL_NAMES))

    def test_tool_contracts_match_contract_json(self) -> None:
        for tool, declared in zip(TOOL_CONTRACTS, CONTRACT["tools"], strict=True):
            with self.subTest(tool["name"]):
                for key in ("name", "title", "description", "scope", "readOnly", "required"):
                    self.assertEqual(tool[key], declared[key])

    def test_every_tool_schema_stands_alone_and_compiles(self) -> None:
        # Each one stands alone, as an MCP client compiles it on its own.
        for tool in TOOL_CONTRACTS:
            for kind in ("inputSchema", "outputSchema"):
                with self.subTest(tool=tool["name"], schema=kind):
                    schema = tool[kind]

                    Draft7Validator.check_schema(schema)
                    self.assertEqual(schema["type"], "object")
                    for ref in refs_in(schema):
                        self.assertTrue(ref.startswith("#/definitions/"), ref)
                        self.assertIn(ref.removeprefix("#/definitions/"), schema["definitions"])

    def test_create_input_schema_accepts_the_fixture_create_input(self) -> None:
        create = next(tool for tool in TOOL_CONTRACTS if tool["name"] == "intake_create_task")
        case = next(case for case in CASES if case["name"] == "create input")

        self.assertTrue(Draft7Validator(create["inputSchema"]).is_valid(case["value"]))

    def test_constants_follow_contract_json(self) -> None:
        self.assertEqual(INTAKE_CONTRACT_VERSION, CONTRACT["contractVersion"])
        self.assertEqual(CONTRACT_TOOL_PREFIX, CONTRACT["reservedToolPrefix"])
        self.assertEqual(READ_SCOPE, CONTRACT["scopes"]["read"])
        self.assertEqual(CREATE_SCOPE, CONTRACT["scopes"]["create"])
        self.assertEqual(SERVICE_TOKEN_RULES, CONTRACT["serviceToken"])


if __name__ == "__main__":
    unittest.main()

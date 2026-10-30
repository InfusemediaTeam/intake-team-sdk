"""Serving one team over streamable HTTP, behind service-token authentication."""

from __future__ import annotations

import asyncio
import contextlib
import json
import sys
from collections.abc import AsyncIterator, Iterator
from typing import Any

import uvicorn
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from starlette.applications import Starlette
from starlette.datastructures import Headers
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.types import Message, Receive, Scope, Send

from ._text import js_trim
from .server import _server_name, build_team_server
from .service_token import (
    ServiceCaller,
    ServiceTokenOptions,
    assert_service_secret,
    verify_service_token,
)
from .task import TaskError
from .team import TeamDefinition

# JSON-RPC codes: a rejected token, an unreadable body, our own failure.
_UNAUTHORIZED_RPC_CODE = -32001
_PARSE_ERROR_RPC_CODE = -32700
_INTERNAL_ERROR_RPC_CODE = -32603

DEFAULT_MCP_PATH = "/mcp"
DEFAULT_HEALTH_PATH = "/health"

# One intake draft is a few kilobytes; this bounds the body generously.
_MAX_BODY_SIZE = 256 * 1024

# The scheme a caller presents its token with.
_BEARER_PREFIX = "Bearer "

# Where the verified caller travels from the token check to the tool handler:
# the ASGI scope of the one request it was verified for.
_CALLER_SCOPE_KEY = "intake_team_sdk.caller"


def create_http_app(
    definition: TeamDefinition,
    auth: ServiceTokenOptions,
    *,
    path: str = DEFAULT_MCP_PATH,
    health_path: str = DEFAULT_HEALTH_PATH,
) -> Starlette:
    """
    The ASGI app `run_http_team_server` serves, for a caller that runs its own
    ASGI server or mounts it inside a larger app. Its lifespan must run: that
    is where the MCP request handling starts. One app serves once.

    Stateless: every POST is self-contained, so the server can be restarted
    underneath a running host without stranding a session.

    Authentication is required rather than optional. An unauthenticated intake
    endpoint is reachable by anyone who can route to it, and the failure is
    silent, so a short secret or a blank issuer or audience stops the app
    being built instead. Each request carries a short-lived token naming this
    server as its audience; the verified caller decides which tools it may
    call.

    Raises `ValueError` if the secret is shorter than 32 characters, the issuer
    or audience is blank, the descriptor does not match its output schema, or a
    team tool name is unusable.
    """
    assert_service_secret(auth.secret)

    if len(js_trim(auth.issuer)) == 0 or len(js_trim(auth.audience)) == 0:
        raise ValueError("A token issuer and audience are required to serve a team over HTTP")

    server = build_team_server(definition, _request_caller)
    # No DNS-rebinding settings: every request must carry a token a browser
    # page cannot obtain, which is the protection that check approximates.
    manager = StreamableHTTPSessionManager(app=server, stateless=True)

    async def health(_request: Request) -> JSONResponse:
        return JSONResponse({"status": "ok", "team": definition.descriptor["team"]["key"]})

    @contextlib.asynccontextmanager
    async def lifespan(_app: Starlette) -> AsyncIterator[None]:
        async with manager.run():
            yield

    return Starlette(
        routes=[
            Route(health_path, health, methods=["GET"]),
            Route(path, _McpEndpoint(manager, auth), methods=["POST"]),
        ],
        lifespan=lifespan,
    )


async def run_http_team_server(
    definition: TeamDefinition,
    port: int,
    auth: ServiceTokenOptions,
    *,
    path: str = DEFAULT_MCP_PATH,
    health_path: str = DEFAULT_HEALTH_PATH,
    host: str = "127.0.0.1",
) -> None:
    """
    Serves one team over streamable HTTP until the surrounding task is
    cancelled, for a host that reaches the server across a network rather than
    spawning it.

    Run it with `asyncio.run(run_http_team_server(team, 8080, auth))`; it needs
    asyncio, as uvicorn does.

    Lifecycle belongs to the caller: no process signal handlers are installed,
    because an application embedding this server has its own shutdown order.
    Ctrl+C still ends `asyncio.run` the usual way.

    Raises `ValueError` before listening, as `create_http_app` does.
    """
    app = create_http_app(definition, auth, path=path, health_path=health_path)
    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level="warning",
        access_log=False,
        # Announcing the server software only helps someone fingerprinting it.
        server_header=False,
    )

    listener = _Listener(config, f"{_server_name(definition)} MCP server listening", path)
    serving = asyncio.ensure_future(listener.serve())

    try:
        await asyncio.shield(serving)
    except asyncio.CancelledError:
        # Cancelled from outside: stop accepting, let requests in flight finish
        # and the MCP lifespan close, then report the cancellation as usual.
        listener.should_exit = True
        await serving

        raise


class _Listener(uvicorn.Server):
    """uvicorn without its signal handlers, announcing the address it bound."""

    def __init__(self, config: uvicorn.Config, announcement: str, path: str) -> None:
        super().__init__(config)
        self._announcement = announcement
        self._path = path

    @contextlib.contextmanager
    def capture_signals(self) -> Iterator[None]:
        yield

    async def startup(self, sockets: Any = None) -> None:
        await super().startup(sockets=sockets)

        if self.started and self.servers:
            host, port = self.servers[0].sockets[0].getsockname()[:2]
            sys.stdout.write(f"{self._announcement} on http://{host}:{port}{self._path}\n")
            sys.stdout.flush()


class _McpEndpoint:
    """
    The token check, then the body check, then the MCP transport.

    Order matters: reading the body first would run the parser on an
    unauthenticated request, exposing its own failure modes to anyone who can
    reach the port.
    """

    def __init__(self, manager: StreamableHTTPSessionManager, auth: ServiceTokenOptions) -> None:
        self._manager = manager
        self._auth = auth

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        headers = Headers(scope=scope)
        caller = _caller_of(headers.get("authorization"), self._auth)

        if caller is None:
            # A protocol-level body rather than a bare 401: the caller is a
            # JSON-RPC client, and a text page is not something it can report.
            await _rpc_error(401, _UNAUTHORIZED_RPC_CODE, "Unauthorized")(scope, receive, send)

            return

        scope[_CALLER_SCOPE_KEY] = caller

        if _is_json(headers.get("content-type")):
            body = await _read_body(receive)

            if body is None:
                await _rpc_error(413, _PARSE_ERROR_RPC_CODE, "Malformed request")(
                    scope, receive, send
                )

                return

            if not _readable_json(body):
                await _rpc_error(400, _PARSE_ERROR_RPC_CODE, "Malformed request")(
                    scope, receive, send
                )

                return

            receive = _replay(body, receive)

        started = False

        async def tracked_send(message: Message) -> None:
            nonlocal started

            if message["type"] == "http.response.start":
                started = True

            await send(message)

        try:
            await self._manager.handle_request(scope, receive, tracked_send)
        except Exception:
            # A response already under way cannot be replaced; raising lets the
            # server drop the connection, which is what happened. Otherwise the
            # caller hears a generic JSON-RPC error and nothing internal.
            if started:
                raise

            await _rpc_error(500, _INTERNAL_ERROR_RPC_CODE, "Internal error")(scope, receive, send)


def _request_caller(server: Server[Any, Any]) -> ServiceCaller:
    """
    The caller verified for the HTTP request this tool call arrived on.

    Fails closed: a call that reached the handler without one is refused rather
    than treated as the trusted stdio case.
    """
    request = server.request_context.request
    caller = request.scope.get(_CALLER_SCOPE_KEY) if isinstance(request, Request) else None

    if not isinstance(caller, ServiceCaller):
        raise TaskError("UNAUTHORIZED", "The call carries no verified caller")

    return caller


def _caller_of(header: str | None, auth: ServiceTokenOptions) -> ServiceCaller | None:
    """
    The verified caller, or `None` for a missing, malformed or rejected token.
    Why a token was refused is not told to the caller.
    """
    if header is None or not header.startswith(_BEARER_PREFIX):
        return None

    try:
        return verify_service_token(js_trim(header[len(_BEARER_PREFIX) :]), auth)
    except Exception:
        return None


def _is_json(content_type: str | None) -> bool:
    if content_type is None:
        return False

    return content_type.split(";", 1)[0].strip().lower() == "application/json"


async def _read_body(receive: Receive) -> bytes | None:
    """The whole body, or `None` once it passes the limit; nothing past it is kept."""
    chunks: list[bytes] = []
    size = 0

    while True:
        message = await receive()

        if message["type"] != "http.request":
            break

        chunk = message.get("body", b"")
        size += len(chunk)

        if size > _MAX_BODY_SIZE:
            return None

        chunks.append(chunk)

        if not message.get("more_body", False):
            break

    return b"".join(chunks)


def _readable_json(body: bytes) -> bool:
    """
    An empty body is left to the transport to refuse; anything else must be a
    JSON object or array, as a strict JSON body parser accepts.
    """
    if len(body) == 0:
        return True

    try:
        parsed = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return False

    return isinstance(parsed, (dict, list))


def _replay(body: bytes, receive: Receive) -> Receive:
    """The body already read, handed to the transport as if it were unread."""
    delivered = False

    async def replayed() -> Message:
        nonlocal delivered

        if not delivered:
            delivered = True

            return {"type": "http.request", "body": body, "more_body": False}

        return await receive()

    return replayed


def _rpc_error(status: int, code: int, message: str) -> JSONResponse:
    return JSONResponse(
        {"jsonrpc": "2.0", "error": {"code": code, "message": message}, "id": None},
        status_code=status,
    )

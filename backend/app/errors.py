"""Error responses in the api.md §1.5 shape: {"error": {"code", "message", "details"}}."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.status, self.code, self.message, self.details = status, code, message, details or {}


def _body(code: str, message: str, details: dict) -> dict:
    return {"error": {"code": code, "message": message, "details": details}}


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(_: Request, e: ApiError):
        return JSONResponse(_body(e.code, e.message, e.details), status_code=e.status)

    @app.exception_handler(RequestValidationError)
    async def bad_request(_: Request, e: RequestValidationError):
        # A JSON syntax error's location is a character offset, not a field: report it as the body.
        problems = [{"field": "" if err["type"] == "json_invalid" else ".".join(str(p) for p in err["loc"][1:]),
                     "problem": err["msg"]} for err in e.errors()]
        message = "; ".join(f"{p['field'] or 'body'}: {p['problem']}" for p in problems)
        return JSONResponse(_body("bad_request", message, {"problems": problems}), status_code=400)

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, e: HTTPException):
        code = {404: "not_found", 405: "bad_request"}.get(e.status_code, "bad_request")
        # Keep the exception's headers (405 sends `Allow`).
        return JSONResponse(_body(code, str(e.detail), {}), status_code=e.status_code, headers=e.headers)

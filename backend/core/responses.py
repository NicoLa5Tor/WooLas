from fastapi.responses import JSONResponse


def success_response(data=None, status_code: int = 200) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"success": True, "data": data, "error": None},
    )


def error_response(message: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"success": False, "data": None, "error": message},
    )

from __future__ import annotations

import pytest

from main import visualize


@pytest.mark.parametrize("flag", ["--port", "--workers"])
def test_visualize_rejects_non_integer_server_options(flag: str, capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        visualize(["serve", flag, "not-an-int"])

    assert exc.value.code == 2
    assert f"{flag} must be an integer" in capsys.readouterr().out

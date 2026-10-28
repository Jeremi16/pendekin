package auth

import (
	"strings"
	"testing"
)

func TestPasswordRoundTrip(t *testing.T) {
	h, err := HashPassword("correct horse battery")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "pbkdf2-sha256$600000$") {
		t.Errorf("unexpected format %q", h)
	}
	if !VerifyPassword("correct horse battery", h) {
		t.Error("correct password rejected")
	}
	if VerifyPassword("wrong", h) {
		t.Error("wrong password accepted")
	}
	h2, _ := HashPassword("correct horse battery")
	if h == h2 {
		t.Error("salt not random")
	}
	for _, bad := range []string{"", "pbkdf2-sha256$x$a$b", "md5$1$a$b", "pbkdf2-sha256$1$!!$!!"} {
		if VerifyPassword("x", bad) {
			t.Errorf("malformed hash %q accepted", bad)
		}
	}
}

func TestValidEmail(t *testing.T) {
	for e, want := range map[string]bool{
		"a@b.co":                           true,
		"Name <a@b.co>":                    false,
		"no-at-sign":                       false,
		"":                                 false,
		strings.Repeat("a", 250) + "@b.co": false,
	} {
		if got := validEmail(e); got != want {
			t.Errorf("validEmail(%q) = %v, want %v", e, got, want)
		}
	}
}

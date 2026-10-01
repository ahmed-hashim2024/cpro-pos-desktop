package tunnel

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"testing"
)

func TestVerifyAndUntar(t *testing.T) {
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(zw)
	body := []byte("#!/bin/sh\n")
	tw.WriteHeader(&tar.Header{Name: "cloudflared", Mode: 0o755, Size: int64(len(body)), Typeflag: tar.TypeReg})
	tw.Write(body)
	tw.Close()
	zw.Close()
	got, err := untarFile(buf.Bytes(), "cloudflared")
	if err != nil || !bytes.Equal(got, body) {
		t.Fatalf("untar: %q %v", got, err)
	}
	if err := verify([]byte("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"); err != nil {
		t.Fatal(err)
	}
	if err := verify([]byte("abd"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"); err == nil {
		t.Fatal("tampered download accepted")
	}
}

func TestEveryAssetHasADigest(t *testing.T) {
	for k, a := range assets {
		if len(a.sha256) != 64 || a.file == "" {
			t.Errorf("%s: %+v", k, a)
		}
	}
}

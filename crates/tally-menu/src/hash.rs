//! SHA-256 over several byte slices without allocating.
use sha2::{Digest, Sha256};

pub fn sha256v(parts: &[&[u8]]) -> [u8; 32] {
    let mut h = Sha256::new();
    for p in parts {
        h.update(p);
    }
    h.finalize().into()
}

#[cfg(test)]
mod tests {
    #[test]
    fn matches_known_vector() {
        let expected =
            hex::decode("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad").unwrap();
        assert_eq!(super::sha256v(&[b"a", b"bc"]).as_slice(), expected.as_slice());
    }
}

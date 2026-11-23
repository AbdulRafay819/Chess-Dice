# Optional GLB piece models

Drop CC0 models here to replace the procedural Staunton set. Any missing file is
expected: the game falls back to its lathe-built pieces, so the game always runs.

File names (lower case, exactly these):

```
white-pawn.glb    black-pawn.glb
white-knight.glb  black-knight.glb
white-bishop.glb  black-bishop.glb
white-rook.glb    black-rook.glb
white-queen.glb   black-queen.glb
white-king.glb    black-king.glb
```

Rules the loader applies:

- Models are scaled to roughly one board square tall (pawns 0.62, others 0.95).
- Each model is re-centred on its own footprint and dropped onto the square.
- Materials are cloned per piece, so a selected piece can glow on its own.
- Knights are rotated for Black automatically; keep models facing +X.

Sources with permissive licences: Poly Pizza, Kenney's chess set, Sketchfab CC0
collections. Check the licence of each download before shipping it.

The board, die and effects are procedural and are not replaced by GLBs.

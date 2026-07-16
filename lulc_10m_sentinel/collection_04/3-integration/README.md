## 01_toWorkspace.js
Prepares and exports the final Cerrado LULC classification for general MapBiomas integration. It splits the multi-band stack into individual annual images, injects standardized metadata attributes (`territory`, `biome`, `collection_id`, `version`, `source`), and exports them.

Crucially, this script enforces a boundary correction within the **Alto Paraguai Watershed (BAP)**. To ensure thematic harmony between biome boundaries, it reclassifies Cerrado's *Mosaic of Uses* (21) based on the overlapping Pantanal classification mapping:

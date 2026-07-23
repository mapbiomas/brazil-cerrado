<div>
    <img src='https://github.com/mapbiomas-brazil/cerrado/blob/mapbiomas60/2-general-map/www/ipam_logo.jpg?raw=true' height='auto' width='160' align='right'>
    <h1> MAPBIOMAS BRAZIL – CERRADO BIOME </h1>
</div>

Developed by the [Instituto de Pesquisa Ambiental da Amazônia (IPAM)](https://ipam.org.br/)

---

## About

This repository contains scripts and resources for the mapping of land use and land cover (LULC) in the **Cerrado biome**, as part of the MapBiomas Brazil initiative. The mapping is based on multi-temporal remote sensing imagery from the **Landsat (30m)** and **Sentinel (10m)** satellite programs.

Most geospatial processing routines were developed for the Google Earth Engine platform. Complementary analyses and validation routines may also use Python and R.

The classification processes include data preparation, model training, classification, and a series of post-processing routines to ensure temporal and spatial consistency of the maps.

For detailed methodology and technical specifications, refer to the Cerrado Biome Appendix of the [Algorithm Theoretical Basis Document (ATBD)](https://brasil.mapbiomas.org/en/atbd-entenda-cada-etapa/).

---

## Repository Structure

The repository is organized into subfolders by image source and processing resolution, following the MapBiomas classification workflow for the Cerrado biome:

- [`lulc_30m_landsat`](https://github.com/mapbiomas/brazil-cerrado/tree/main/lulc_30m_landsat):  
  Scripts for generating annual LULC maps at **30-meter resolution**, using Landsat imagery. The current Landsat pipeline is Collection 11, covering 1985–2025.

- [`lulc_10m_sentinel`](https://github.com/mapbiomas/brazil-cerrado/tree/main/lulc_10m_sentinel):  
  Scripts for generating annual LULC maps at **10-meter resolution**, using Sentinel-2 imagery. The current Sentinel pipeline is Collection 04, covering 2017–2025.

Each subfolder includes a step-by-step processing chain with classification scripts, filtering procedures, and additional assets used in the generation of MapBiomas Cerrado collections.

---

## Citation

If you use any part of this repository or the resulting data in your work, please cite MapBiomas and IPAM accordingly. For official data access and citation guidelines, visit the [MapBiomas Terms of Use](https://brasil.mapbiomas.org/en/termos-de-uso/). The MapBiomas data are public, open, and free under Creative Commons CC-BY license.

---

## Machine-Readable Metadata

The `collections.yml` file provides structured metadata about the current products. This file is intended to improve repository indexing, automated documentation, dataset catalogs, software agents, AI-assisted searches, and machine-readable discovery.

---

## Contact

For questions, technical suggestions, or issue reports, contact:

- [barbara.silva@ipam.org.br](mailto:barbara.silva@ipam.org.br)  
- [dhemerson.costa@ipam.org.br](mailto:dhemerson.costa@ipam.org.br)
- [contato@mapbiomas.org](mailto:contato@mapbiomas.org)
